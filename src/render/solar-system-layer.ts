import { Body } from 'astronomy-engine';
import * as THREE from 'three';
import { eqjToWorld, type ObservationFrame } from '../astro/coordinates.ts';
import type { SolarBodyPosition } from '../astro/ephemeris.ts';
import { clamp, normalize, type Vec3 } from '../astro/math.ts';
import { atmosphereFunction, skyShaderDeclarations } from './shaders.ts';
import type { SkyUniforms } from './sky-uniforms.ts';

const vertexShader = /* glsl */ `
  ${skyShaderDeclarations}
  ${atmosphereFunction}
  uniform float uViewportWidth;
  uniform float uViewportHeight;
  uniform float uDaylight;
  uniform float uMoonlight;
  attribute vec3 aWorldDirection;
  attribute vec3 aColor;
  attribute vec3 aLightWorld;
  attribute float aMagnitude;
  attribute float aAngularRadius;
  attribute float aMinimumSize;
  attribute float aKind;
  varying vec2 vLocal;
  varying vec3 vColor;
  varying vec3 vLightView;
  varying float vKind;
  varying float vAlpha;

  void main() {
    vec4 center = skyClipFromWorld(aWorldDirection);
    float angularDiameter = aAngularRadius * uViewportHeight / uFovScale;
    float discDiameter = max(aMinimumSize, angularDiameter);
    float quadDiameter = discDiameter * 1.9;
    vec2 offset = position.xy * quadDiameter / vec2(uViewportWidth, uViewportHeight);
    gl_Position = vec4(center.xy / center.w + offset, 0.0, 1.0);
    vLocal = position.xy * 1.9;
    vColor = aColor;
    vLightView = normalize(uWorldToView * aLightWorld);
    vKind = aKind;

    float altitude = degrees(asin(clamp(aWorldDirection.y, -1.0, 1.0)));
    float daylight = smoothstep(0.0, 0.35, uDaylight);
    float faintVisibility = clamp(1.3 - 0.18 * max(aMagnitude, 0.0), 0.0, 1.0);
    float daylightVisibility = mix(1.0, faintVisibility, daylight);
    if (aKind < 0.5) daylightVisibility = 1.0;
    if (aKind > 0.5 && aKind < 1.5) daylightVisibility = mix(1.0, 0.72, daylight);
    vAlpha = skyTransmission(altitude) * daylightVisibility;
    vAlpha *= 1.0 - clamp(uMoonlight * 2.0, 0.0, 0.25);
    if (altitude < -0.5 || vAlpha <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vAlpha = 0.0;
    }
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vColor;
  varying vec3 vLightView;
  varying float vKind;
  varying float vAlpha;

  void main() {
    float radius = length(vLocal);
    if (radius > 1.9 || vAlpha <= 0.0) discard;
    float disc = 1.0 - smoothstep(0.94, 1.0, radius);
    float illumination = 1.0;
    if (vKind > 0.5 && radius < 1.0) {
      vec3 normal = vec3(vLocal, sqrt(max(0.0, 1.0 - radius * radius)));
      illumination = smoothstep(-0.12, 0.08, dot(normal, normalize(vLightView)));
    }
    float haloStrength = vKind < 0.5 ? 0.34 : 0.13;
    float halo = (1.0 - smoothstep(0.72, 1.9, radius)) * haloStrength;
    vec3 color = vColor;
    if (vKind < 0.5) color *= 1.05 + halo * 0.7;
    else color *= 0.1 + 0.9 * illumination;
    float discAlpha = vKind < 0.5 ? 1.0 : 0.22 + 0.78 * illumination;
    float alpha = clamp(disc * discAlpha + halo * (1.0 - disc), 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export class SolarSystemLayer {
  readonly mesh: THREE.Mesh;

  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly directions = new Float32Array(9 * 3);
  private readonly colors = new Float32Array(9 * 3);
  private readonly lights = new Float32Array(9 * 3);
  private readonly magnitudes = new Float32Array(9);
  private readonly angularRadii = new Float32Array(9);
  private readonly minimumSizes = new Float32Array(9);
  private readonly kinds = new Float32Array(9);
  private readonly attributes: THREE.InstancedBufferAttribute[] = [];

  constructor(uniforms: SkyUniforms) {
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
    );
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.addAttribute('aWorldDirection', this.directions, 3);
    this.addAttribute('aColor', this.colors, 3);
    this.addAttribute('aLightWorld', this.lights, 3);
    this.addAttribute('aMagnitude', this.magnitudes, 1);
    this.addAttribute('aAngularRadius', this.angularRadii, 1);
    this.addAttribute('aMinimumSize', this.minimumSizes, 1);
    this.addAttribute('aKind', this.kinds, 1);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  update(bodies: SolarBodyPosition[], frame: ObservationFrame): void {
    const sun = bodies.find((body) => body.body === Body.Sun);
    if (!sun) return;
    this.geometry.instanceCount = bodies.length;
    bodies.forEach((body, index) => {
      this.directions.set(body.worldDirection, index * 3);
      this.colors.set(body.color, index * 3);
      const lightEqj: Vec3 = [
        sun.eqjDirection[0] * sun.distanceAu - body.eqjDirection[0] * body.distanceAu,
        sun.eqjDirection[1] * sun.distanceAu - body.eqjDirection[1] * body.distanceAu,
        sun.eqjDirection[2] * sun.distanceAu - body.eqjDirection[2] * body.distanceAu,
      ];
      this.lights.set(normalize(eqjToWorld(lightEqj, frame)), index * 3);
      this.magnitudes[index] = body.magnitude;
      this.angularRadii[index] = body.angularRadius;
      this.minimumSizes[index] =
        body.body === Body.Sun
          ? 20
          : body.body === Body.Moon
            ? 16
            : clamp(8 - body.magnitude * 0.45, 5, 12);
      this.kinds[index] = body.body === Body.Sun ? 0 : body.body === Body.Moon ? 1 : 2;
    });
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private addAttribute(name: string, data: Float32Array, itemSize: number): void {
    const attribute = new THREE.InstancedBufferAttribute(data, itemSize);
    attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute(name, attribute);
    this.attributes.push(attribute);
  }
}
