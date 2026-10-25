export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function angularDistanceDegrees(a: number, b: number): number {
  return Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(vector: Vec3): number {
  return Math.hypot(...vector);
}

export function normalize(vector: Vec3): Vec3 {
  const magnitude = length(vector);
  if (magnitude < 1e-15) return [0, 0, 0];
  return scale(vector, 1 / magnitude);
}

export function transform(matrix: Mat3, vector: Vec3): Vec3 {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const result = Array.from({ length: 9 }, () => 0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result[row * 3 + column] =
        (a[row * 3] ?? 0) * (b[column] ?? 0) +
        (a[row * 3 + 1] ?? 0) * (b[3 + column] ?? 0) +
        (a[row * 3 + 2] ?? 0) * (b[6 + column] ?? 0);
    }
  }
  return result as Mat3;
}

export function transpose(matrix: Mat3): Mat3 {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

export function smoothstep(minimum: number, maximum: number, value: number): number {
  const t = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
}
