import { Body } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  createObservationFrame,
  horizontalToWorld,
  worldToEqj,
  type ObservationFrame,
} from '../src/astro/coordinates.ts';
import { computeSolarBodies } from '../src/astro/ephemeris.ts';
import { cross, normalize, scale, type Mat3, type Vec3 } from '../src/astro/math.ts';
import type { NamedStar } from '../src/data/catalog.ts';
import { pickSkyTarget, resolveSkyTarget } from '../src/render/picking.ts';
import { formatDeclination, formatRightAscension } from '../src/ui/info-card.ts';

const frame = createObservationFrame(new Date('2024-01-01T16:00:00Z'), {
  latitude: 31.23,
  longitude: 121.47,
});
const bodies = computeSolarBodies(frame);
const sun = bodies.find((body) => body.body === Body.Sun);
if (!sun) throw new Error('Missing test Sun');
const visibleSun = {
  ...sun,
  worldDirection: horizontalToWorld(180, 32),
  horizontal: { azimuth: 180, altitude: 32 },
};

function viewMatrix(forward: Vec3): Mat3 {
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  const backward = scale(forward, -1);
  return [...right, ...up, ...backward];
}

function namedStar(record: Float32Array): NamedStar {
  return {
    hip: 123,
    name: '测试星',
    english: 'Test star',
    native: '测试星',
    record: Array.from(record) as NamedStar['record'],
  };
}

function input(frameValue: ObservationFrame, bodiesValue = [visibleSun]) {
  const forward = visibleSun.worldDirection;
  const baseDirection = worldToEqj(forward, frameValue);
  const record = new Float32Array([...baseDirection, 0, 0, 3.2, 0.65, 123, 100, 404]);
  return {
    x: 400,
    y: 300,
    width: 800,
    height: 600,
    fov: 75,
    worldToView: viewMatrix(forward),
    frame: frameValue,
    chunks: [{ bin: { maxFov: 180 }, data: record }],
    bodies: bodiesValue,
    names: new Map([[123, namedStar(record)]]),
  };
}

describe('celestial picking', () => {
  it('prioritizes a solar body over a star at the same screen position', () => {
    expect(pickSkyTarget(input(frame))).toEqual({ kind: 'solar', body: Body.Sun });
  });

  it('finds a loaded star and resolves its name and observing coordinates', () => {
    const picked = pickSkyTarget(input(frame, []));
    expect(picked?.kind).toBe('star');
    if (!picked) throw new Error('Missing picked target');
    const resolved = resolveSkyTarget(picked, frame, bodies);
    expect(resolved.kind).toBe('star');
    if (resolved.kind !== 'star') throw new Error('Expected a star');
    expect(resolved.name).toBe('测试星');
    expect(resolved.hip).toBe(123);
    expect(resolved.tyc).toBe('TYC 100-101-0');
    expect(resolved.horizontal.altitude).toBeCloseTo(32, 0);
    expect(resolved.j2000.ra).toBeGreaterThanOrEqual(0);
  });

  it('does not search chunks hidden at the current field of view', () => {
    const picking = input(frame, []);
    const chunk = picking.chunks[0];
    if (!chunk) throw new Error('Missing test chunk');
    chunk.bin.maxFov = 6;
    expect(pickSkyTarget(picking)).toBeUndefined();
  });

  it('formats sexagesimal coordinates for the information card', () => {
    expect(formatRightAscension(6.5)).toBe('06h 30m 00.0s');
    expect(formatRightAscension(24)).toBe('00h 00m 00.0s');
    expect(formatDeclination(-16.5)).toBe('−16° 30′ 00″');
    expect(formatDeclination(0)).toBe('+00° 00′ 00″');
  });
});
