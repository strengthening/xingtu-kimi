import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCATION, LOCATION_PRESETS } from '../src/data/locations.ts';

describe('observer location presets', () => {
  it('defaults to Shanghai and provides valid unique presets', () => {
    expect(DEFAULT_LOCATION).toMatchObject({ id: 'shanghai', latitude: 31.23, longitude: 121.47 });
    expect(new Set(LOCATION_PRESETS.map((location) => location.id)).size).toBe(
      LOCATION_PRESETS.length,
    );
    for (const location of LOCATION_PRESETS) {
      expect(Math.abs(location.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(location.longitude)).toBeLessThanOrEqual(180);
      expect(location.hemisphere === 'north' ? location.latitude >= 0 : location.latitude < 0).toBe(
        true,
      );
      expect(() => new Intl.DateTimeFormat('zh-CN', { timeZone: location.timeZone })).not.toThrow();
    }
  });

  it('keeps a focused Chinese selection and broad southern coverage', () => {
    const chinese = LOCATION_PRESETS.filter((location) => location.name.startsWith('中国'));
    const southern = LOCATION_PRESETS.filter((location) => location.hemisphere === 'south');
    expect(chinese.map((location) => location.id)).toEqual([
      'shanghai',
      'beijing',
      'guangzhou',
      'urumqi',
      'harbin',
    ]);
    expect(southern.length).toBeGreaterThanOrEqual(16);
    expect(southern.some((location) => location.name.includes('澳大利亚'))).toBe(true);
    expect(southern.some((location) => /巴西|阿根廷|智利|秘鲁/.test(location.name))).toBe(true);
    expect(southern.some((location) => /南非|肯尼亚|纳米比亚/.test(location.name))).toBe(true);
    expect(southern.some((location) => /斐济|波利尼西亚|巴布亚|新西兰/.test(location.name))).toBe(
      true,
    );
  });
});
