import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObservationFrame, worldToEqj } from '../src/astro/coordinates.ts';
import type { ConstellationCatalog, NameCatalog, StarRecord } from '../src/data/catalog.ts';
import { loadSkyMetadata } from '../src/data/sky-metadata.ts';
import { createSkyLabels, labelMagnitudeLimit } from '../src/ui/sky-labels.ts';

const frame = createObservationFrame(new Date('2024-01-01T16:00:00Z'), {
  latitude: 31.23,
  longitude: 121.47,
});
const zenith = worldToEqj([0, 1, 0], frame);
const firstRecord: StarRecord = [...zenith, 0, 0, 1.5, 0.4, 1, 10, 4];
const secondRecord: StarRecord = [...zenith, 0, 0, 2.1, 0.5, 2, 20, 4];
const names: NameCatalog = {
  version: 1,
  stars: [
    { hip: 1, name: '亮星', english: 'Bright', native: '亮星', record: firstRecord },
    { hip: 2, name: '次亮星', english: 'Second', native: '次亮星', record: secondRecord },
  ],
};
const constellations: ConstellationCatalog = {
  version: 1,
  stars: { '1': firstRecord, '2': secondRecord },
  cultures: {
    modern: [
      { id: 'modern-test', english: 'Modern', native: 'Moderna', segments: [], labelHip: 2 },
    ],
    chinese: [
      { id: 'chinese-test', english: 'Enclosure', native: '紫微垣', segments: [], labelHip: 1 },
    ],
  },
  lunarMansions: [{ hip: 1, english: 'Horn', native: '角', symbol: '1' }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sky metadata and labels', () => {
  it('loads and validates the generated name and constellation catalogs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const body = path.endsWith('names.json') ? names : constellations;
        return Promise.resolve(Response.json(body));
      }),
    );
    await expect(loadSkyMetadata(new AbortController().signal)).resolves.toEqual({
      names,
      constellations,
    });
  });

  it('rejects malformed metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ version: 2 }))),
    );
    await expect(loadSkyMetadata(new AbortController().signal)).rejects.toThrow('格式无效');
  });

  it('starts below magnitude two and progressively reveals fainter names', () => {
    expect(labelMagnitudeLimit(75)).toBe(2);
    expect(labelMagnitudeLimit(30)).toBe(3);
    expect(labelMagnitudeLimit(15)).toBe(4);
    expect(labelMagnitudeLimit(8)).toBe(5);
    expect(labelMagnitudeLimit(4)).toBe(6);
    expect(labelMagnitudeLimit(1)).toBe(7);
  });

  it('labels enabled cultures and lunar mansions using apparent star positions', () => {
    const labels = createSkyLabels({
      frame,
      fov: 75,
      names,
      constellations,
      showModern: false,
      showChinese: true,
      project: () => ({ x: 100, y: 100, visible: true }),
    });
    expect(labels.map((label) => label.id)).toEqual([
      'star-1',
      'chinese-chinese-test',
      'mansion-1',
    ]);
    expect(labels[0]?.text).toBe('亮星');
    expect(labels[1]?.text).toBe('紫微垣');
    expect(labels[2]?.text).toBe('角宿');
    expect(labels.every((label) => label.visible)).toBe(true);
  });

  it('derives all three enclosure labels from their wall geometry', () => {
    const wallNames = ['紫微左垣', '紫微右垣', '太微左垣', '太微右垣', '天市左垣', '天市右垣'];
    const walls = wallNames.map((native, index) => ({
      id: `wall-${index}`,
      english: native,
      native,
      segments: [[1, 2]] as Array<[number, number]>,
      labelHip: 1,
    }));
    const enclosureCatalog: ConstellationCatalog = {
      ...constellations,
      cultures: { modern: [], chinese: walls },
      lunarMansions: [],
    };
    const labels = createSkyLabels({
      frame,
      fov: 75,
      names: { version: 1, stars: [] },
      constellations: enclosureCatalog,
      showModern: false,
      showChinese: true,
      project: () => ({ x: 100, y: 100, visible: true }),
    });
    const enclosures = labels.filter((label) => label.id.startsWith('chinese-enclosure-'));
    expect(enclosures.map((label) => label.text)).toEqual(['紫微垣', '太微垣', '天市垣']);
    expect(enclosures.every((label) => label.visible)).toBe(true);
  });
});
