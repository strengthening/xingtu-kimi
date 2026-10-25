import { describe, expect, it } from 'vitest';
import { createSceneUrl, parseSceneUrl, type SharedSceneState } from '../src/ui/scene-url.ts';

const state: SharedSceneState = {
  location: { latitude: -33.87, longitude: 151.21 },
  date: new Date('2024-06-01T16:00:00.000Z'),
  view: { azimuth: 142.125, altitude: 18.25, fov: 5.75 },
  playing: false,
  rate: 3600,
  display: {
    chinese: false,
    modern: true,
    horizontal: true,
    equatorial: false,
    hips: true,
    labels: false,
    atmosphere: 47,
  },
};

describe('shared scene URLs', () => {
  it('round-trips observer, time, view, playback and display settings', () => {
    const url = createSceneUrl('https://example.test/sky?old=value#sky', state);
    const restored = parseSceneUrl(url);
    expect(restored).toEqual(state);
    expect(new URL(url).hash).toBe('#sky');
    expect(new URL(url).searchParams.has('old')).toBe(false);
  });

  it('leaves ordinary URLs untouched and accepts ISO times without milliseconds', () => {
    expect(parseSceneUrl('https://example.test/sky')).toBeUndefined();
    const url = new URL(createSceneUrl('https://example.test/sky', state));
    url.searchParams.set('time', '2024-06-01T16:00:00Z');
    expect(parseSceneUrl(url.toString())?.date.toISOString()).toBe('2024-06-01T16:00:00.000Z');
  });

  it.each([
    ['lat', '91'],
    ['lon', '-181'],
    ['time', '2024-02-30T00:00:00Z'],
    ['az', '360'],
    ['alt', '-91'],
    ['fov', '0'],
    ['rate', '13'],
    ['labels', 'yes'],
    ['air', '0.5'],
  ])('rejects an invalid %s parameter instead of partially restoring', (key, value) => {
    const url = new URL(createSceneUrl('https://example.test/sky', state));
    url.searchParams.set(key, value);
    expect(() => parseSceneUrl(url.toString())).toThrow();
  });

  it('rejects incomplete and unsupported scenes', () => {
    const url = new URL(createSceneUrl('https://example.test/sky', state));
    url.searchParams.delete('lon');
    expect(() => parseSceneUrl(url.toString())).toThrow('lon');
    const unsupported = new URL(createSceneUrl('https://example.test/sky', state));
    unsupported.searchParams.set('v', '2');
    expect(() => parseSceneUrl(unsupported.toString())).toThrow('version');
  });
});
