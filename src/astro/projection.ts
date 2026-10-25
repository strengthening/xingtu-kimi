import { DEG2RAD, clamp, type Vec3 } from './math.ts';

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
}

export function stereographicScale(fovDegrees: number): number {
  return 2 * Math.tan((clamp(fovDegrees, 0.1, 160) * DEG2RAD) / 4);
}

export function projectStereographic(
  direction: Vec3,
  fovDegrees: number,
  aspect: number,
): ProjectedPoint {
  const magnitude = Math.hypot(...direction);
  if (magnitude < 1e-12) return { x: 0, y: 0, visible: false };
  const x = direction[0] / magnitude;
  const y = direction[1] / magnitude;
  const z = direction[2] / magnitude;
  const denominator = Math.max(1e-7, 1 - z);
  const scale = stereographicScale(fovDegrees);
  const ndcX = (2 * x) / (denominator * scale * aspect);
  const ndcY = (2 * y) / (denominator * scale);
  return {
    x: ndcX,
    y: ndcY,
    visible: 1 - z > 1e-7 && Math.abs(ndcX) <= 1.02 && Math.abs(ndcY) <= 1.02,
  };
}

export function unprojectStereographic(
  x: number,
  y: number,
  fovDegrees: number,
  aspect: number,
): Vec3 {
  const scale = stereographicScale(fovDegrees);
  const projectedX = x * aspect * scale;
  const projectedY = y * scale;
  const radius = Math.hypot(projectedX, projectedY);
  if (radius < 1e-12) return [0, 0, -1];
  const theta = 2 * Math.atan(radius / 2);
  const radial = Math.sin(theta) / radius;
  return [projectedX * radial, projectedY * radial, -Math.cos(theta)];
}

export function ndcToScreen(
  point: ProjectedPoint,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  return {
    x: (point.x * 0.5 + 0.5) * width,
    y: (0.5 - point.y * 0.5) * height,
    visible: point.visible,
  };
}

export function fieldRadiusRadians(fovDegrees: number, aspect: number): number {
  const scale = stereographicScale(fovDegrees);
  return 2 * Math.atan(Math.hypot(scale * aspect, scale) / 2);
}
