import { describe, expect, it, vi } from 'vitest';
import {
  atmosphericTransmission,
  moonlightStrength,
  relativeAirmass,
} from '../src/astro/atmosphere.ts';
import { createObservationFrame } from '../src/astro/coordinates.ts';
import { SOLAR_BODY_DEFINITIONS, computeSolarBodies } from '../src/astro/ephemeris.ts';
import { SimulationClock } from '../src/astro/time.ts';

describe('simulation clock', () => {
  it('advances at forward and reverse rates and supports pausing', () => {
    const clock = new SimulationClock(new Date('2024-01-01T00:00:00Z'));
    expect(clock.tick(1000).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    clock.setRate(60);
    expect(clock.tick(2000).toISOString()).toBe('2024-01-01T00:01:00.000Z');
    clock.setPlaying(false);
    expect(clock.tick(5000).toISOString()).toBe('2024-01-01T00:01:00.000Z');
    clock.setRate(-3600);
    clock.setPlaying(true);
    expect(clock.tick(6000).toISOString()).toBe('2023-12-31T23:01:00.000Z');
  });

  it('sets valid dates and resets real-time deltas', () => {
    const clock = new SimulationClock(new Date(0));
    expect(() => clock.setDate(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => clock.setRate(0)).toThrow(RangeError);
    clock.tick(1000);
    clock.resetRealTime();
    expect(clock.tick(9000).getTime()).toBe(0);
    const now = new Date('2026-01-02T03:04:05Z');
    vi.setSystemTime(now);
    clock.setNow();
    expect(clock.date).toEqual(now);
    vi.useRealTimers();
  });
});

describe('atmosphere', () => {
  it('models relative airmass and extinction', () => {
    expect(relativeAirmass(90)).toBeCloseTo(1, 3);
    expect(relativeAirmass(30)).toBeGreaterThan(1.9);
    expect(relativeAirmass(0)).toBeGreaterThan(30);
    expect(atmosphericTransmission(90, 0)).toBe(1);
    expect(atmosphericTransmission(10, 0.5)).toBeLessThan(atmosphericTransmission(60, 0.5));
    expect(atmosphericTransmission(-1, 1)).toBe(0);
  });

  it('ties moonlight to phase, altitude, and atmosphere density', () => {
    expect(moonlightStrength(30, 1, 0)).toBe(0);
    expect(moonlightStrength(-10, 1, 1)).toBe(0);
    expect(moonlightStrength(30, 0.5, 1)).toBeCloseTo(0.0375, 8);
    expect(moonlightStrength(30, 1, 1)).toBeGreaterThan(moonlightStrength(0, 1, 1));
  });
});

describe('solar-system ephemeris', () => {
  it('computes finite topocentric positions for the Sun, Moon, and seven other planets', () => {
    const frame = createObservationFrame(new Date('2024-04-08T18:00:00Z'), {
      latitude: 31.23,
      longitude: 121.47,
    });
    const bodies = computeSolarBodies(frame);
    expect(bodies).toHaveLength(SOLAR_BODY_DEFINITIONS.length);
    expect(bodies.map((body) => body.body)).toEqual(
      SOLAR_BODY_DEFINITIONS.map((body) => body.body),
    );
    for (const body of bodies) {
      expect(body.worldDirection.every(Number.isFinite)).toBe(true);
      expect(body.horizontal.azimuth).toBeGreaterThanOrEqual(0);
      expect(body.horizontal.azimuth).toBeLessThan(360);
      expect(Math.abs(body.horizontal.altitude)).toBeLessThanOrEqual(90);
      expect(body.equatorial.ra).toBeGreaterThanOrEqual(0);
      expect(body.equatorial.ra).toBeLessThan(24);
      expect(body.distanceAu).toBeGreaterThan(0);
      expect(Number.isFinite(body.magnitude)).toBe(true);
      expect(body.phaseFraction).toBeGreaterThanOrEqual(0);
      expect(body.phaseFraction).toBeLessThanOrEqual(1);
      expect(body.angularRadius).toBeGreaterThan(0);
      expect(body.angularRadius).toBeLessThan(0.02);
    }
  });
});
