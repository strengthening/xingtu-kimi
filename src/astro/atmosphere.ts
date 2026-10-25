import { clamp, smoothstep } from './math.ts';

export function relativeAirmass(altitudeDegrees: number): number {
  const altitude = clamp(altitudeDegrees, 0, 90);
  return clamp(
    1 / (Math.sin((altitude * Math.PI) / 180) + 0.50572 * (altitude + 6.07995) ** -1.6364),
    1,
    40,
  );
}

export function atmosphericTransmission(altitudeDegrees: number, density: number): number {
  if (altitudeDegrees < -0.5) return 0;
  const opticalDepth = 0.28 * clamp(density, 0, 1) * relativeAirmass(altitudeDegrees);
  return 10 ** (-0.4 * opticalDepth) * smoothstep(-0.5, 0.5, altitudeDegrees);
}

export function daylightStrength(sunAltitudeDegrees: number, density: number): number {
  return clamp(density, 0, 1) * smoothstep(-18, 4, sunAltitudeDegrees);
}

export function moonlightStrength(
  moonAltitudeDegrees: number,
  illuminatedFraction: number,
  density: number,
): number {
  return (
    clamp(density, 0, 1) *
    clamp(illuminatedFraction, 0, 1) *
    smoothstep(-6, 12, moonAltitudeDegrees) *
    0.075
  );
}
