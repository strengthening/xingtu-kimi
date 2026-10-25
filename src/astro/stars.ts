import type { ObservationFrame } from './coordinates.ts';
import { add, cross, dot, normalize, scale, type Vec3 } from './math.ts';

export function propagateProperMotion(
  baseDirection: Vec3,
  pmRa: number,
  pmDec: number,
  years: number,
): Vec3 {
  const base = normalize(baseDirection);
  let east = cross([0, 0, 1], base);
  if (Math.hypot(...east) < 1e-10) east = [1, 0, 0];
  east = normalize(east);
  const north = normalize(cross(base, east));
  return normalize(add(base, scale(add(scale(east, pmRa), scale(north, pmDec)), years)));
}

export function applyAnnualAberration(direction: Vec3, observerVelocity: Vec3): Vec3 {
  const natural = normalize(direction);
  const speedSquared = dot(observerVelocity, observerVelocity);
  if (speedSquared < 1e-18) return natural;
  const inverseGamma = Math.sqrt(1 - speedSquared);
  const projection = dot(natural, observerVelocity);
  const velocityFactor = 1 + projection / (1 + inverseGamma);
  return normalize(
    scale(
      add(scale(natural, inverseGamma), scale(observerVelocity, velocityFactor)),
      1 / (1 + projection),
    ),
  );
}

export function apparentStarDirection(
  baseDirection: Vec3,
  pmRa: number,
  pmDec: number,
  frame: ObservationFrame,
  aberration = true,
): Vec3 {
  const propagated = propagateProperMotion(baseDirection, pmRa, pmDec, frame.yearsSinceJ2000);
  return aberration ? applyAnnualAberration(propagated, frame.earthVelocity) : propagated;
}

export function angularSeparation(a: Vec3, b: Vec3): number {
  const first = normalize(a);
  const second = normalize(b);
  return Math.acos(Math.max(-1, Math.min(1, dot(first, second))));
}
