import * as THREE from 'three';
import { worldToEqj, type ObservationFrame } from '../astro/coordinates.ts';
import { directionToHealpix } from '../astro/healpix.ts';
import { fieldRadiusRadians } from '../astro/projection.ts';
import { HEALPIX_ORDER, STAR_FLOATS } from '../data/catalog.ts';
import type { LoadedStarChunk, StarCatalog } from '../data/star-catalog.ts';
import { atmosphereFunction, apparentStarFunction, skyShaderDeclarations } from './shaders.ts';
import type { SkyUniforms } from './sky-uniforms.ts';
import type { ViewController } from './view-controller.ts';

const vertexShader = /* glsl */ `
  ${skyShaderDeclarations}
  ${apparentStarFunction}
  ${atmosphereFunction}

  attribute vec2 aProperMotion;
  attribute float aMagnitude;
  attribute float aColorIndex;
  uniform float uFov;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;

  vec3 stellarColor(float colorIndex) {
    vec3 blue = vec3(0.60, 0.73, 1.0);
    vec3 white = vec3(0.91, 0.95, 1.0);
    vec3 yellow = vec3(1.0, 0.94, 0.78);
    vec3 orange = vec3(1.0, 0.69, 0.43);
    if (colorIndex < 0.25) return mix(blue, white, smoothstep(-0.35, 0.25, colorIndex));
    if (colorIndex < 0.9) return mix(white, yellow, smoothstep(0.25, 0.9, colorIndex));
    return mix(yellow, orange, smoothstep(0.9, 1.8, colorIndex));
  }

  void main() {
    vec3 worldDirection = apparentStarWorld(position, aProperMotion);
    float altitude = degrees(asin(clamp(worldDirection.y, -1.0, 1.0)));
    float transmission = skyTransmission(altitude);
    gl_Position = skyClipFromWorld(worldDirection);

    float radius = clamp(3.8 - 0.38 * (aMagnitude + 1.5), 0.65, 4.8);
    float zoomBoost = 1.0 + 0.65 * (1.0 - smoothstep(6.0, 70.0, uFov));
    gl_PointSize = radius * 2.0 * uPixelRatio * zoomBoost;
    vColor = stellarColor(aColorIndex);
    vAlpha = transmission * clamp(pow(10.0, -0.12 * (aMagnitude - 1.0)), 0.075, 1.6);
    if (worldDirection.y < -0.009 || transmission <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
    }
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float radius = length(point);
    if (radius > 1.0 || vAlpha <= 0.0) discard;
    float core = exp(-radius * radius * 12.0);
    float halo = pow(max(0.0, 1.0 - radius), 2.4) * 0.52;
    float alpha = (core + halo) * vAlpha;
    gl_FragColor = vec4(vColor * (0.82 + core * 0.55), alpha);
    #include <colorspace_fragment>
  }
`;

export class StarLayer {
  readonly group = new THREE.Group();

  private readonly material: THREE.ShaderMaterial;
  private readonly points = new Map<string, THREE.Points>();
  private lastFov = -1;
  private syncKey = '';

  constructor(
    private readonly catalog: StarCatalog,
    uniforms: SkyUniforms,
    private readonly view: ViewController,
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.renderOrder = 5;
    this.catalog.onChunkLoaded = (chunk) => this.addChunk(chunk);
    this.catalog.onChunkEvicted = (key) => this.removeChunk(key);
  }

  async loadVisible(frame: ObservationFrame, aspect: number): Promise<void> {
    const center = worldToEqj(this.view.forward, frame);
    const radius = fieldRadiusRadians(this.view.fov, aspect);
    this.syncKey = this.makeSyncKey(center, aspect);
    await this.catalog.update(center, radius, this.view.fov);
    this.updateVisibility();
  }

  sync(frame: ObservationFrame, aspect: number): void {
    const center = worldToEqj(this.view.forward, frame);
    const key = this.makeSyncKey(center, aspect);
    if (key === this.syncKey) return;
    this.syncKey = key;
    const radius = fieldRadiusRadians(this.view.fov, aspect);
    void this.catalog.update(center, radius, this.view.fov).catch(() => undefined);
    this.updateVisibility();
  }

  invalidate(): void {
    this.syncKey = '';
  }

  dispose(): void {
    for (const key of [...this.points.keys()]) this.removeChunk(key);
    this.material.dispose();
    this.catalog.onChunkLoaded = undefined;
    this.catalog.onChunkEvicted = undefined;
  }

  private addChunk(chunk: LoadedStarChunk): void {
    if (this.points.has(chunk.key)) return;
    const interleaved = new THREE.InterleavedBuffer(chunk.data, STAR_FLOATS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    geometry.setAttribute('aProperMotion', new THREE.InterleavedBufferAttribute(interleaved, 2, 3));
    geometry.setAttribute('aMagnitude', new THREE.InterleavedBufferAttribute(interleaved, 1, 5));
    geometry.setAttribute('aColorIndex', new THREE.InterleavedBufferAttribute(interleaved, 1, 6));
    const points = new THREE.Points(geometry, this.material);
    points.frustumCulled = false;
    points.visible = this.view.fov <= chunk.bin.maxFov;
    this.points.set(chunk.key, points);
    this.group.add(points);
  }

  private removeChunk(key: string): void {
    const points = this.points.get(key);
    if (!points) return;
    this.group.remove(points);
    points.geometry.dispose();
    this.points.delete(key);
  }

  private updateVisibility(): void {
    if (this.lastFov === this.view.fov) return;
    this.lastFov = this.view.fov;
    for (const [key, points] of this.points) {
      const binId = Number(key.split('-')[1]);
      points.visible = this.view.fov <= (this.catalog.manifest.bins[binId]?.maxFov ?? 0);
    }
  }

  private makeSyncKey(center: [number, number, number], aspect: number): string {
    const tile = directionToHealpix(center, HEALPIX_ORDER);
    return `${tile}:${this.view.fov.toFixed(2)}:${aspect.toFixed(3)}`;
  }
}
