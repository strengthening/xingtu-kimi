import { afterEach, describe, expect, it, vi } from 'vitest';
import { directionToHealpix } from '../src/astro/healpix.ts';
import { normalize, type Vec3 } from '../src/astro/math.ts';
import type { CatalogBin, CatalogManifest } from '../src/data/catalog.ts';
import { StarCatalog } from '../src/data/star-catalog.ts';

const center: Vec3 = normalize([0.3, -0.7, 0.5]);
const pixel = directionToHealpix(center, 3);
const record = new Float32Array([0.3, -0.7, 0.5, 0, 0, 5, 0.6, 1, 2, 3]);

function bin(id: number, scope: CatalogBin['scope'], maxFov: number): CatalogBin {
  return {
    id,
    scope,
    maxFov,
    minMagnitude: null,
    maxMagnitude: null,
    count: 1,
    files: [
      scope === 'global'
        ? { path: `global-${id}.bin`, count: 1, bytes: record.byteLength }
        : { path: `tile-${id}.bin`, count: 1, bytes: record.byteLength, pixel },
    ],
  };
}

function manifest(): CatalogManifest {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    source: 'Tycho-2 I/259 + supplement 1',
    recordFloats: 10,
    recordBytes: 40,
    recordLayout: [],
    healpixOrder: 3,
    totalStars: 1_000_001,
    totalInput: 1_000_001,
    invalidRecords: 0,
    filteredSolarRecords: 0,
    bins: [bin(0, 'global', 180), bin(3, 'healpix', 25)],
  };
}

function response(body: BodyInit, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/octet-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('star catalog loading', () => {
  it('loads global and visible tiled chunks once and reuses their cache', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        paths.push(path);
        if (path.endsWith('stars-manifest.json'))
          return Promise.resolve(response(JSON.stringify(manifest())));
        if (path.endsWith('.bin')) return Promise.resolve(response(record.buffer.slice(0)));
        return Promise.resolve(response('missing', 404));
      }),
    );
    const catalog = new StarCatalog();
    const loaded: string[] = [];
    catalog.onChunkLoaded = (chunk) => loaded.push(chunk.key);
    await catalog.initialize();
    await catalog.update(center, 0.5, 75);
    expect(paths.filter((path) => path.endsWith('.bin'))).toEqual(['/data/global-0.bin']);
    await catalog.update(center, 0.5, 75);
    await catalog.update(center, 0.1, 5);
    await catalog.update(center, 0.1, 5);
    expect(paths.filter((path) => path.endsWith('.bin'))).toEqual([
      '/data/global-0.bin',
      '/data/tile-3.bin',
    ]);
    expect(loaded).toEqual(['global-0', `bin-3-pixel-${pixel}`]);
    expect(catalog.loadedChunkCount).toBe(2);
    expect(catalog.getChunk(0)?.data[5]).toBe(5);
    catalog.dispose();
  });

  it('rejects malformed manifests and inconsistent chunk sizes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (path.endsWith('stars-manifest.json'))
          return Promise.resolve(response(JSON.stringify(manifest())));
        return Promise.resolve(response(new ArrayBuffer(8)));
      }),
    );
    const catalog = new StarCatalog();
    await catalog.initialize();
    await expect(catalog.update(center, 0.5, 75)).rejects.toThrow('字节数校验失败');
    catalog.dispose();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(response(JSON.stringify({ version: 1 })))),
    );
    const invalid = new StarCatalog();
    await expect(invalid.initialize()).rejects.toThrow('目录格式或数据规模无效');
    invalid.dispose();
  });
});
