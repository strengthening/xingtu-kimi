import { Healpix } from 'healpixjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HipsClient,
  HipsProjector,
  decodeHipsTiles,
  parseHipsProperties,
  type HipsProperties,
  type HipsTile,
} from '../src/data/hips-client.ts';

const propertiesSource = `
# test metadata
obs_title = DSS2 Color Test
hips_order = 9
hips_frame = equatorial
hips_tile_width = 4
hips_pixel_format = jpeg fits
`;

function properties(): HipsProperties {
  return parseHipsProperties(propertiesSource);
}

function syntheticTiles(tileWidth: number): HipsTile[] {
  return Array.from({ length: 12 }, (_, face) => {
    const data = new Uint8ClampedArray(tileWidth * tileWidth * 4);
    for (let sourceY = 0; sourceY < tileWidth; sourceY += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const iy = tileWidth - 1 - sourceY;
        const offset = (sourceY * tileWidth + x) * 4;
        data[offset] = face * 15;
        data[offset + 1] = x * 50;
        data[offset + 2] = iy * 50;
        data[offset + 3] = 255;
      }
    }
    return { data, width: tileWidth, height: tileWidth };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DSS2 HiPS metadata and failure handling', () => {
  it('validates equatorial JPEG properties and rejects unsupported surveys', () => {
    expect(properties()).toEqual({
      title: 'DSS2 Color Test',
      order: 9,
      tileWidth: 4,
      pixelFormat: 'jpeg fits',
    });
    expect(() => parseHipsProperties(propertiesSource.replace('equatorial', 'galactic'))).toThrow(
      '元数据不受支持',
    );
    expect(() =>
      parseHipsProperties(propertiesSource.replace('tile_width = 4', 'tile_width = 3')),
    ).toThrow('元数据不受支持');
    expect(() => parseHipsProperties(propertiesSource.replace('jpeg fits', 'fits'))).toThrow(
      '元数据不受支持',
    );
    expect(
      parseHipsProperties(propertiesSource.replace('hips_pixel_format = jpeg fits', ''))
        .pixelFormat,
    ).toBe('');
  });

  it('surfaces tile HTTP errors instead of substituting a fake sky image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (path.endsWith('/properties')) return Promise.resolve(new Response(propertiesSource));
        return Promise.resolve(new Response('missing', { status: 404 }));
      }),
    );
    const client = new HipsClient('https://example.test/hips');
    await expect(client.load()).rejects.toThrow('HTTP 404');
    client.dispose();
  });
});

describe('HiPS NESTED tile decoding', () => {
  it('maps all twelve base faces and flips image rows into an equatorial texture', async () => {
    const tileWidth = 4;
    const tiles = syntheticTiles(tileWidth);
    const survey = await decodeHipsTiles(tiles, properties(), 256, 128);
    const healpix = new Healpix(tileWidth);
    const projector = new HipsProjector(tileWidth);
    for (let face = 0; face < 12; face += 1) {
      for (let iy = 0; iy < tileWidth; iy += 1) {
        for (let ix = 0; ix < tileWidth; ix += 1) {
          const vector = healpix.pix2vec(healpix.xyf2nest(ix, iy, face));
          const direction: [number, number, number] = [vector.x, vector.y, vector.z];
          expect(projector.coordinates(direction)).toEqual({
            face,
            x: ix,
            y: tileWidth - 1 - iy,
          });
          const u = Math.atan2(vector.y, vector.x) / (2 * Math.PI) + 0.5;
          const v = Math.asin(vector.z) / Math.PI + 0.5;
          const x = Math.min(survey.width - 1, Math.max(0, Math.floor(u * survey.width)));
          const y = Math.min(survey.height - 1, Math.max(0, Math.floor(v * survey.height)));
          const offset = (y * survey.width + x) * 4;
          expect([
            survey.data[offset],
            survey.data[offset + 1],
            survey.data[offset + 2],
            survey.data[offset + 3],
          ]).toEqual([face * 15, ix * 50, iy * 50, 255]);
        }
      }
    }
  });

  it('rejects incomplete or inconsistent tile data', async () => {
    const tiles = syntheticTiles(4);
    await expect(decodeHipsTiles(tiles.slice(1), properties(), 32, 16)).rejects.toThrow(
      '全天切片不完整',
    );
    const [first, ...rest] = tiles;
    if (!first) throw new Error('Missing synthetic tile');
    const invalid = [{ ...first, width: 2 }, ...rest];
    await expect(decodeHipsTiles(invalid, properties(), 32, 16)).rejects.toThrow(
      '尺寸与元数据不一致',
    );
  });
});
