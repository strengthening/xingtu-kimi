import { Healpix, Pointing } from 'healpixjs';
import type { Vec3 } from '../astro/math.ts';

const BASE_TILE_COUNT = 12;
const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;

export interface HipsProperties {
  title: string;
  order: number;
  tileWidth: number;
  pixelFormat: string;
}

export interface HipsTile {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface HipsSurvey {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  properties: HipsProperties;
}

export interface HipsTileCoordinate {
  face: number;
  x: number;
  y: number;
}

export function parseHipsProperties(source: string): HipsProperties {
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  const order = Number(values.get('hips_order'));
  const tileWidth = Number(values.get('hips_tile_width'));
  const frame = values.get('hips_frame');
  const pixelFormat = values.get('hips_pixel_format') ?? '';
  if (
    frame !== 'equatorial' ||
    !Number.isInteger(order) ||
    order < 0 ||
    !Number.isInteger(tileWidth) ||
    tileWidth <= 0 ||
    tileWidth > 4096 ||
    (tileWidth & (tileWidth - 1)) !== 0 ||
    (pixelFormat.length > 0 && !/(?:jpeg|jpg)/i.test(pixelFormat))
  ) {
    const details = `frame=${frame ?? 'missing'}, order=${values.get('hips_order') ?? 'missing'}, width=${values.get('hips_tile_width') ?? 'missing'}, format=${pixelFormat || 'missing'}`;
    throw new Error(`DSS2 HiPS 元数据不受支持（${details}），需要赤道坐标与 JPEG 切片`);
  }
  return {
    title: values.get('obs_title') || 'DSS2 Color',
    order,
    tileWidth,
    pixelFormat,
  };
}

export class HipsProjector {
  private readonly healpix: Healpix;
  private readonly pointing = new Pointing(null, false, 0, 0);

  constructor(readonly tileWidth: number) {
    this.healpix = new Healpix(tileWidth);
  }

  coordinates(direction: Vec3): HipsTileCoordinate {
    const theta = Math.acos(Math.max(-1, Math.min(1, direction[2])));
    const phi = (Math.atan2(direction[1], direction[0]) + 2 * Math.PI) % (2 * Math.PI);
    return this.angularCoordinates(theta, phi);
  }

  angularCoordinates(theta: number, phi: number): HipsTileCoordinate {
    this.pointing.theta = theta;
    this.pointing.phi = phi;
    const nested = this.healpix.ang2pix(this.pointing);
    const { ix, iy, face } = this.healpix.nest2xyf(nested);
    return { face, x: ix, y: this.tileWidth - 1 - iy };
  }
}

export async function decodeHipsTiles(
  tiles: readonly HipsTile[],
  properties: HipsProperties,
  width = TEXTURE_WIDTH,
  height = TEXTURE_HEIGHT,
): Promise<HipsSurvey> {
  if (tiles.length !== BASE_TILE_COUNT) throw new Error('DSS2 HiPS 全天切片不完整');
  for (const tile of tiles) {
    if (
      tile.width !== properties.tileWidth ||
      tile.height !== properties.tileWidth ||
      tile.data.length !== tile.width * tile.height * 4
    ) {
      throw new Error('DSS2 HiPS 切片尺寸与元数据不一致');
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  const projector = new HipsProjector(properties.tileWidth);
  for (let y = 0; y < height; y += 1) {
    const theta = (1 - (y + 0.5) / height) * Math.PI;
    for (let x = 0; x < width; x += 1) {
      const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      const coordinate = projector.angularCoordinates(theta, phi);
      const tile = tiles[coordinate.face];
      if (!tile) continue;
      const source = (coordinate.y * tile.width + coordinate.x) * 4;
      const target = (y * width + x) * 4;
      data[target] = tile.data[source] ?? 0;
      data[target + 1] = tile.data[source + 1] ?? 0;
      data[target + 2] = tile.data[source + 2] ?? 0;
      data[target + 3] = 255;
    }
    if (y % 32 === 31) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { data, width, height, properties };
}

export class HipsClient {
  onProgress: ((loaded: number, total: number) => void) | undefined;

  private readonly abort = new AbortController();
  private pending: Promise<HipsSurvey> | undefined;

  constructor(private readonly baseUrl = 'https://alasky.cds.unistra.fr/DSS/DSSColor') {}

  load(): Promise<HipsSurvey> {
    if (!this.pending) {
      const request = this.fetchSurvey().catch((error: unknown) => {
        if (this.pending === request) this.pending = undefined;
        throw error;
      });
      this.pending = request;
    }
    return this.pending;
  }

  dispose(): void {
    this.abort.abort();
    this.pending = undefined;
    this.onProgress = undefined;
  }

  private async fetchSurvey(): Promise<HipsSurvey> {
    const response = await fetch(`${this.baseUrl}/properties`, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`DSS2 HiPS 元数据读取失败（HTTP ${response.status}）`);
    const properties = parseHipsProperties(await response.text());
    let loaded = 0;
    this.onProgress?.(0, BASE_TILE_COUNT);
    const tiles = await Promise.all(
      Array.from({ length: BASE_TILE_COUNT }, (_, face) =>
        this.fetchTile(face, properties.tileWidth).then((tile) => {
          loaded += 1;
          this.onProgress?.(loaded, BASE_TILE_COUNT);
          return tile;
        }),
      ),
    );
    return decodeHipsTiles(tiles, properties);
  }

  private async fetchTile(face: number, tileWidth: number): Promise<HipsTile> {
    const path = `${this.baseUrl}/Norder0/Dir0/Npix${face}.jpg`;
    const response = await fetch(path, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`DSS2 HiPS 切片读取失败（HTTP ${response.status}）`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      if (bitmap.width !== tileWidth || bitmap.height !== tileWidth) {
        throw new Error('DSS2 HiPS 切片尺寸与元数据不一致');
      }
      const canvas = document.createElement('canvas');
      canvas.width = tileWidth;
      canvas.height = tileWidth;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('浏览器无法解码 DSS2 HiPS 切片');
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, tileWidth, tileWidth);
      return { data: image.data, width: tileWidth, height: tileWidth };
    } finally {
      bitmap.close();
    }
  }
}
