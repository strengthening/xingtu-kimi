import { describe, expect, it } from 'vitest';
import { createObservationFrame, equatorialToDirection } from '../src/astro/coordinates.ts';
import {
  directionToHealpix,
  healpixCenter,
  healpixPixelForEquatorial,
  healpixPixelsForCone,
} from '../src/astro/healpix.ts';
import { DEG2RAD, angularDistanceDegrees, dot, normalize } from '../src/astro/math.ts';
import {
  fieldRadiusRadians,
  projectStereographic,
  stereographicScale,
  unprojectStereographic,
} from '../src/astro/projection.ts';
import {
  angularSeparation,
  apparentStarDirection,
  applyAnnualAberration,
  propagateProperMotion,
} from '../src/astro/stars.ts';

describe('stellar apparent motion', () => {
  it('propagates proper motion along local tangent axes', () => {
    const base = equatorialToDirection(6.7525, -16.7161);
    const pmRa = (-546.01e-3 * DEG2RAD) / 3600;
    const pmDec = (-1223.07e-3 * DEG2RAD) / 3600;
    const moved = propagateProperMotion(base, pmRa, pmDec, 24);
    const expected = Math.atan(24 * Math.hypot(pmRa, pmDec));
    expect(angularSeparation(base, moved)).toBeCloseTo(expected, 11);
    expect(dot(moved, moved)).toBeCloseTo(1, 12);
  });

  it('keeps zero proper motion fixed and handles celestial poles', () => {
    const pole: [number, number, number] = [0, 0, 1];
    expect(propagateProperMotion(pole, 0, 0, 1000)).toEqual(pole);
    const moved = propagateProperMotion(pole, 1e-6, -2e-6, 10);
    expect(moved.every(Number.isFinite)).toBe(true);
    expect(dot(moved, moved)).toBeCloseTo(1, 12);
  });

  it('applies relativistic annual aberration in the velocity direction', () => {
    const base: [number, number, number] = [1, 0, 0];
    const beta: [number, number, number] = [0, 1e-4, 0];
    const apparent = applyAnnualAberration(base, beta);
    expect(angularSeparation(base, apparent)).toBeCloseTo(1e-4, 10);
    expect(apparent[1]).toBeGreaterThan(0);
    expect(applyAnnualAberration(base, [0, 0, 0])).toEqual(base);
  });

  it('produces a sub-arcminute annual aberration for Earth', () => {
    const frame = createObservationFrame(new Date('2024-03-20T00:00:00Z'), {
      latitude: 31.23,
      longitude: 121.47,
    });
    const base = equatorialToDirection(12, 20);
    const apparent = apparentStarDirection(base, 0, 0, frame);
    const separation = angularSeparation(base, apparent);
    expect(separation).toBeGreaterThan(0);
    expect(separation).toBeLessThan((25 * DEG2RAD) / 3600);
  });
});

describe('stereographic projection', () => {
  it('round-trips screen coordinates throughout the field', () => {
    for (const fov of [1, 60, 150]) {
      for (const [x, y] of [
        [0, 0],
        [-0.75, 0.4],
        [0.9, -0.85],
      ] as const) {
        const direction = unprojectStereographic(x, y, fov, 1.6);
        const projected = projectStereographic(direction, fov, 1.6);
        expect(projected.x).toBeCloseTo(x, 10);
        expect(projected.y).toBeCloseTo(y, 10);
        expect(projected.visible).toBe(true);
      }
    }
  });

  it('uses the stereographic angular scale and conservative field radius', () => {
    expect(stereographicScale(60)).toBeCloseTo(2 * Math.tan(15 * DEG2RAD), 12);
    const center = unprojectStereographic(0, 0, 60, 1);
    const corner = unprojectStereographic(1, 1, 60, 1);
    expect(fieldRadiusRadians(60, 1)).toBeCloseTo(angularSeparation(center, corner), 12);
  });
});

describe('HEALPix tiling', () => {
  it('maps directions and equatorial angles to identical NESTED pixels', () => {
    const direction = normalize([0.3, -0.7, 0.5]);
    const pixel = directionToHealpix(direction, 3);
    const theta = Math.acos(direction[2]);
    const phi = (Math.atan2(direction[1], direction[0]) + 2 * Math.PI) % (2 * Math.PI);
    expect(healpixPixelForEquatorial(theta, phi, 3)).toBe(pixel);
    expect(directionToHealpix(healpixCenter(pixel, 3), 3)).toBe(pixel);
  });

  it('returns unique tiles covering the requested cone', () => {
    const center = normalize([1, 0.2, -0.1]);
    const pixels = healpixPixelsForCone(center, 8 * DEG2RAD, 3);
    expect(pixels.length).toBeGreaterThan(1);
    expect(new Set(pixels).size).toBe(pixels.length);
    expect(pixels).toContain(directionToHealpix(center, 3));
    for (const pixel of pixels) {
      expect(healpixCenter(pixel, 3).every(Number.isFinite)).toBe(true);
    }
  });
});

describe('angular utilities', () => {
  it('measures wrapped angular distances', () => {
    expect(angularDistanceDegrees(359, 1)).toBe(2);
    expect(angularDistanceDegrees(-170, 170)).toBe(20);
  });
});
