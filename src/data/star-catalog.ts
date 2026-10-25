import { HEALPIX_ORDER, STAR_BYTES, STAR_FLOATS } from './catalog.ts';
import type { CatalogBin, CatalogFile, CatalogManifest } from './catalog.ts';
import { healpixPixelsForCone } from '../astro/healpix.ts';
import type { Vec3 } from '../astro/math.ts';

export interface LoadedStarChunk {
  key: string;
  bin: CatalogBin;
  file: CatalogFile;
  data: Float32Array;
  lastUsed: number;
}

export interface CatalogProgress {
  pending: number;
  loadedStars: number;
  totalStars: number;
}

const CACHE_LIMIT_BYTES = 160 * 1024 * 1024;

function chunkKey(bin: CatalogBin, file: CatalogFile): string {
  return bin.scope === 'global' ? `global-${bin.id}` : `bin-${bin.id}-pixel-${file.pixel ?? 0}`;
}

export class StarCatalog {
  onChunkLoaded: ((chunk: LoadedStarChunk) => void) | undefined;
  onChunkEvicted: ((key: string) => void) | undefined;
  onProgress: ((progress: CatalogProgress) => void) | undefined;
  onError: ((error: Error) => void) | undefined;

  private readonly chunks = new Map<string, LoadedStarChunk>();
  private readonly pending = new Map<string, Promise<LoadedStarChunk>>();
  private readonly abort = new AbortController();
  private manifestValue: CatalogManifest | undefined;
  private desiredKeys = new Set<string>();
  private updateGeneration = 0;
  private loadedStars = 0;
  private cacheBytes = 0;
  private disposed = false;

  constructor(private readonly baseUrl = '/data') {}

  get manifest(): CatalogManifest {
    if (!this.manifestValue) throw new Error('Star catalog manifest has not been loaded');
    return this.manifestValue;
  }

  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  loadedChunks(): IterableIterator<LoadedStarChunk> {
    return this.chunks.values();
  }

  async initialize(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/stars-manifest.json`, {
      signal: this.abort.signal,
    });
    if (!response.ok) {
      throw new Error(`星表目录读取失败（HTTP ${response.status}），请先运行 pnpm data:build`);
    }
    const manifest = (await response.json()) as CatalogManifest;
    if (
      manifest.version !== 1 ||
      manifest.recordFloats !== STAR_FLOATS ||
      manifest.recordBytes !== STAR_BYTES ||
      !Array.isArray(manifest.bins) ||
      manifest.totalStars < 1_000_000
    ) {
      throw new Error('星表目录格式或数据规模无效，请重新运行 pnpm data:build');
    }
    this.manifestValue = manifest;
  }

  async update(centerEqj: Vec3, fieldRadius: number, fov: number): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.updateGeneration;
    const now = performance.now();
    const activeBins = this.manifest.bins.filter((bin) => fov <= bin.maxFov);
    const files: Array<{ bin: CatalogBin; file: CatalogFile }> = [];
    const desired = new Set<string>();

    for (const bin of activeBins.filter((candidate) => candidate.scope === 'global')) {
      for (const file of bin.files) {
        desired.add(chunkKey(bin, file));
        files.push({ bin, file });
      }
    }

    const tiledBins = activeBins.filter((bin) => bin.scope === 'healpix');
    if (tiledBins.length > 0) {
      const pixels = healpixPixelsForCone(centerEqj, fieldRadius + 0.015, HEALPIX_ORDER);
      for (const bin of tiledBins) {
        const byPixel = new Map(bin.files.map((file) => [file.pixel, file]));
        for (const pixel of pixels) {
          const file = byPixel.get(pixel);
          if (!file) continue;
          desired.add(chunkKey(bin, file));
          files.push({ bin, file });
        }
      }
    }

    this.desiredKeys = desired;
    let completed = 0;
    this.reportProgress(files.length - completed);
    await Promise.all(
      files.map(async ({ bin, file }) => {
        try {
          await this.load(bin, file, now);
        } finally {
          completed += 1;
          if (generation === this.updateGeneration) this.reportProgress(files.length - completed);
        }
      }),
    );
    if (generation === this.updateGeneration) this.evictUnusedTiles();
  }

  getChunk(binId: number, pixel?: number): LoadedStarChunk | undefined {
    const key = pixel === undefined ? `global-${binId}` : `bin-${binId}-pixel-${pixel}`;
    return this.chunks.get(key);
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.chunks.clear();
    this.pending.clear();
    this.onChunkLoaded = undefined;
    this.onChunkEvicted = undefined;
    this.onProgress = undefined;
    this.onError = undefined;
  }

  private load(bin: CatalogBin, file: CatalogFile, now: number): Promise<LoadedStarChunk> {
    const key = chunkKey(bin, file);
    const cached = this.chunks.get(key);
    if (cached) {
      cached.lastUsed = now;
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;

    const request = this.fetchChunk(bin, file, key, now)
      .then((chunk) => {
        this.pending.delete(key);
        if (this.disposed) return chunk;
        this.chunks.set(key, chunk);
        this.cacheBytes += chunk.data.byteLength;
        this.loadedStars += chunk.file.count;
        this.onChunkLoaded?.(chunk);
        return chunk;
      })
      .catch((error: unknown) => {
        this.pending.delete(key);
        if (!this.disposed) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          this.onError?.(normalized);
        }
        throw error;
      });
    this.pending.set(key, request);
    return request;
  }

  private async fetchChunk(
    bin: CatalogBin,
    file: CatalogFile,
    key: string,
    now: number,
  ): Promise<LoadedStarChunk> {
    const response = await fetch(`${this.baseUrl}/${file.path}`, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`星表分块 ${file.path} 读取失败（HTTP ${response.status}）`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== file.bytes || buffer.byteLength !== file.count * STAR_BYTES) {
      throw new Error(`星表分块 ${file.path} 字节数校验失败`);
    }
    const data = new Float32Array(buffer);
    if (data.length !== file.count * STAR_FLOATS) {
      throw new Error(`星表分块 ${file.path} 记录数校验失败`);
    }
    return { key, bin, file, data, lastUsed: now };
  }

  private reportProgress(pending: number): void {
    this.onProgress?.({
      pending,
      loadedStars: this.loadedStars,
      totalStars: this.manifest.totalStars,
    });
  }

  private evictUnusedTiles(): void {
    if (this.cacheBytes <= CACHE_LIMIT_BYTES) return;
    const candidates = [...this.chunks.values()]
      .filter((chunk) => chunk.bin.scope === 'healpix' && !this.desiredKeys.has(chunk.key))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const chunk of candidates) {
      if (this.cacheBytes <= CACHE_LIMIT_BYTES) break;
      this.chunks.delete(chunk.key);
      this.cacheBytes -= chunk.data.byteLength;
      this.loadedStars -= chunk.file.count;
      this.onChunkEvicted?.(chunk.key);
    }
  }
}
