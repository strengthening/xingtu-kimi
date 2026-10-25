import { Healpix, Pointing } from 'healpixjs';

export type Vector3Tuple = [number, number, number];

const healpixCache = new Map<number, Healpix>();

function getHealpix(order: number): Healpix {
  let healpix = healpixCache.get(order);
  if (!healpix) {
    healpix = new Healpix(2 ** order);
    healpixCache.set(order, healpix);
  }
  return healpix;
}

function pointingForDirection([x, y, z]: Vector3Tuple): Pointing {
  const phi = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  return new Pointing(null, false, Math.acos(Math.max(-1, Math.min(1, z))), phi);
}

export function directionToHealpix(direction: Vector3Tuple, order: number): number {
  return getHealpix(order).ang2pix(pointingForDirection(direction));
}

export function healpixCenter(pixel: number, order: number): Vector3Tuple {
  const vector = getHealpix(order).pix2vec(pixel);
  return [vector.x, vector.y, vector.z];
}

export function healpixRadius(order: number): number {
  return getHealpix(order).maxPixrad();
}

export function healpixPixelsForCone(
  center: Vector3Tuple,
  radius: number,
  order: number,
): number[] {
  const healpix = getHealpix(order);
  const pixels: number[] = [];
  const extendedRadius = radius + healpix.maxPixrad();
  const threshold = Math.cos(extendedRadius);
  for (let pixel = 0; pixel < healpix.getNPix(); pixel += 1) {
    const direction = healpix.pix2vec(pixel);
    const dot = direction.x * center[0] + direction.y * center[1] + direction.z * center[2];
    if (dot >= threshold) pixels.push(pixel);
  }
  return pixels;
}

export function healpixPixelForEquatorial(
  theta: number,
  phi: number,
  order: number,
  pointing?: Pointing,
): number {
  const target = pointing ?? new Pointing(null, false, theta, phi);
  target.theta = theta;
  target.phi = phi;
  return getHealpix(order).ang2pix(target);
}
