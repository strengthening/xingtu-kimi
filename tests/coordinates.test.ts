import { Horizon } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  apparentEquatorial,
  createObservationFrame,
  directionToEquatorial,
  eqjToHorizontal,
  eqjToWorld,
  equatorialToDirection,
  horizontalToWorld,
  worldToEqj,
  worldToHorizontal,
} from '../src/astro/coordinates.ts';
import { angularDistanceDegrees, type Vec3 } from '../src/astro/math.ts';
import { apparentStarDirection } from '../src/astro/stars.ts';

const SHANGHAI = { latitude: 31.23, longitude: 121.47 };

describe('observation coordinates', () => {
  it('matches Stellarium Web for Sirius within 0.1 degree', () => {
    const frame = createObservationFrame(new Date('2024-01-01T16:00:00.000Z'), SHANGHAI);
    const base: Vec3 = [-0.18745523010245282, 0.9392175285052327, -0.28762991995924053];
    const direction = apparentStarDirection(
      base,
      -0.000002647082698858066,
      -0.0000059297561336507335,
      frame,
    );
    const horizontal = eqjToHorizontal(direction, frame);

    // Stellarium Web, geometric observed frame, without atmospheric refraction.
    expect(angularDistanceDegrees(horizontal.azimuth, 180.93116760245144)).toBeLessThan(0.1);
    expect(Math.abs(horizontal.altitude - 42.0161706504889)).toBeLessThan(0.1);
  });

  it('matches astronomy-engine horizon conversion at multiple locations', () => {
    const cases = [
      { date: '2024-01-01T16:00:00.000Z', location: SHANGHAI },
      { date: '2025-06-15T03:30:00.000Z', location: { latitude: -33.87, longitude: 151.21 } },
      { date: '2023-11-05T12:00:00.000Z', location: { latitude: 64.15, longitude: -21.94 } },
    ];
    const direction = equatorialToDirection(18.6156, 38.7837);

    for (const testCase of cases) {
      const frame = createObservationFrame(new Date(testCase.date), testCase.location);
      const apparent = apparentEquatorial(direction, frame);
      const expected = Horizon(frame.time, frame.observer, apparent.ra, apparent.dec);
      const actual = eqjToHorizontal(direction, frame);
      expect(actual.azimuth).toBeCloseTo(expected.azimuth, 8);
      expect(actual.altitude).toBeCloseTo(expected.altitude, 8);
    }
  });

  it('round-trips equatorial and local world coordinates', () => {
    const frame = createObservationFrame(new Date('2026-04-12T08:00:00.000Z'), SHANGHAI);
    for (const [ra, dec] of [
      [0, 0],
      [6.75, -16.72],
      [23.99, 89.9],
    ] as const) {
      const source = equatorialToDirection(ra, dec);
      const restored = directionToEquatorial(worldToEqj(eqjToWorld(source, frame), frame));
      expect(angularDistanceDegrees(restored.ra * 15, ra * 15)).toBeLessThan(1e-9);
      expect(restored.dec).toBeCloseTo(dec, 10);
    }
  });

  it('uses north-based clockwise azimuth and east-up-minus-north world axes', () => {
    expect(horizontalToWorld(0, 0)).toEqual([0, 0, -1]);
    const east = horizontalToWorld(90, 0);
    expect(east[0]).toBeCloseTo(1, 12);
    expect(east[1]).toBe(0);
    expect(east[2]).toBeCloseTo(0, 12);
    expect(horizontalToWorld(0, 90)[1]).toBeCloseTo(1, 12);
    for (const [azimuth, altitude] of [
      [0, 0],
      [135, 25],
      [359.9, -45],
    ] as const) {
      const restored = worldToHorizontal(horizontalToWorld(azimuth, altitude));
      expect(restored.azimuth).toBeCloseTo(azimuth, 10);
      expect(restored.altitude).toBeCloseTo(altitude, 10);
    }
  });
});
