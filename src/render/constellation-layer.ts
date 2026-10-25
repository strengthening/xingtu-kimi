import * as THREE from 'three';
import type { ConstellationCatalog, ConstellationFigure, StarRecord } from '../data/catalog.ts';
import { apparentStarFunction, atmosphereFunction, skyShaderDeclarations } from './shaders.ts';
import type { SkyUniforms } from './sky-uniforms.ts';

const vertexShader = /* glsl */ `
  ${skyShaderDeclarations}
  ${apparentStarFunction}
  ${atmosphereFunction}
  attribute vec2 aProperMotion;
  uniform float uDaylight;
  uniform float uMoonlight;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    vec3 worldDirection = apparentStarWorld(position, aProperMotion);
    float altitude = degrees(asin(clamp(worldDirection.y, -1.0, 1.0)));
    float daylight = 1.0 - 0.8 * smoothstep(0.0, 0.35, uDaylight);
    float moonlight = 1.0 - clamp(uMoonlight * 2.0, 0.0, 0.25);
    vAlpha = uOpacity * skyTransmission(altitude) * daylight * moonlight;
    gl_Position = skyClipFromWorld(worldDirection);
    if (worldDirection.y < -0.009) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vAlpha = 0.0;
    }
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.001) discard;
    gl_FragColor = vec4(uColor, vAlpha);
    #include <colorspace_fragment>
  }
`;

export class ConstellationLayer {
  readonly group = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private modern: THREE.LineSegments | undefined;
  private chinese: THREE.LineSegments | undefined;

  constructor(private readonly uniforms: SkyUniforms) {
    this.group.renderOrder = 6;
  }

  setCatalog(catalog: ConstellationCatalog): void {
    this.modern = this.createLines(catalog.cultures.modern, catalog.stars, 0x7397b5, 0.3);
    this.chinese = this.createLines(catalog.cultures.chinese, catalog.stars, 0xb39973, 0.28);
    this.group.add(this.modern, this.chinese);
  }

  setVisible(culture: 'modern' | 'chinese', visible: boolean): void {
    const lines = culture === 'modern' ? this.modern : this.chinese;
    if (lines) lines.visible = visible;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.clear();
  }

  private createLines(
    figures: ConstellationFigure[],
    stars: Record<string, StarRecord>,
    color: number,
    opacity: number,
  ): THREE.LineSegments {
    const positions: number[] = [];
    const properMotions: number[] = [];
    for (const figure of figures) {
      for (const [fromHip, toHip] of figure.segments) {
        const from = stars[String(fromHip)];
        const to = stars[String(toHip)];
        if (!from || !to) continue;
        positions.push(from[0], from[1], from[2], to[0], to[1], to[2]);
        properMotions.push(from[3], from[4], to[3], to[4]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aProperMotion', new THREE.Float32BufferAttribute(properMotions, 2));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 6;
    this.geometries.push(geometry);
    this.materials.push(material);
    return lines;
  }
}
