import * as THREE from 'three';
import { stereographicScale } from '../astro/projection.ts';

export function createSkyUniforms() {
  return {
    uEqjToWorld: { value: new THREE.Matrix3() },
    uWorldToView: { value: new THREE.Matrix3() },
    uEarthVelocity: { value: new THREE.Vector3() },
    uYearsSinceJ2000: { value: 0 },
    uFovScale: { value: stereographicScale(75) },
    uAspect: { value: 1 },
    uFov: { value: 75 },
    uPixelRatio: { value: 1 },
    uAtmosphere: { value: 0.32 },
  };
}

export type SkyUniforms = ReturnType<typeof createSkyUniforms>;
