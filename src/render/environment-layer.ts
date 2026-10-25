import * as THREE from 'three';
import { equatorialToDirection, horizontalToWorld } from '../astro/coordinates.ts';
import type { Vec3 } from '../astro/math.ts';
import { skyShaderDeclarations } from './shaders.ts';
import type { SkyUniforms } from './sky-uniforms.ts';

const lineVertexShader = /* glsl */ `
  ${skyShaderDeclarations}
  uniform mat3 uEqjToWorld;
  uniform float uEquatorial;
  void main() {
    vec3 equatorial = normalize(uEqjToWorld * position);
    vec3 worldDirection = normalize(mix(position, equatorial, uEquatorial));
    gl_Position = skyClipFromWorld(worldDirection);
  }
`;

const lineFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }
`;

const groundVertexShader = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const groundFragmentShader = /* glsl */ `
  uniform mat3 uWorldToView;
  uniform float uFovScale;
  uniform float uAspect;
  varying vec2 vNdc;
  void main() {
    vec2 projected = vNdc * uFovScale * vec2(uAspect, 1.0);
    float radius = length(projected);
    float theta = 2.0 * atan(radius * 0.5);
    float radial = radius < 0.000001 ? 0.0 : sin(theta) / radius;
    vec3 viewDirection = vec3(projected * radial, -cos(theta));
    vec3 worldDirection = normalize(transpose(uWorldToView) * viewDirection);
    float altitude = degrees(asin(clamp(worldDirection.y, -1.0, 1.0)));
    float ground = 1.0 - smoothstep(-0.12, 0.12, altitude);
    if (ground <= 0.0) discard;
    float depth = clamp(-altitude / 30.0, 0.0, 1.0);
    vec3 color = mix(vec3(0.022, 0.033, 0.044), vec3(0.002, 0.004, 0.007), depth);
    gl_FragColor = vec4(color, ground * 0.97);
    #include <colorspace_fragment>
  }
`;

function lineMaterial(
  uniforms: SkyUniforms,
  color: number,
  opacity: number,
  equatorial: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uEquatorial: { value: equatorial ? 1 : 0 },
    },
    vertexShader: lineVertexShader,
    fragmentShader: lineFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

function segmentsGeometry(paths: Vec3[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      if (previous && current) positions.push(...previous, ...current);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function horizontalGridPaths(): Vec3[][] {
  const paths: Vec3[][] = [];
  for (let altitude = -75; altitude <= 75; altitude += 15) {
    const path: Vec3[] = [];
    for (let azimuth = 0; azimuth <= 360; azimuth += 3)
      path.push(horizontalToWorld(azimuth, altitude));
    paths.push(path);
  }
  for (let azimuth = 0; azimuth < 360; azimuth += 30) {
    const path: Vec3[] = [];
    for (let altitude = -90; altitude <= 90; altitude += 3)
      path.push(horizontalToWorld(azimuth, altitude));
    paths.push(path);
  }
  return paths;
}

function equatorialGridPaths(): Vec3[][] {
  const paths: Vec3[][] = [];
  for (let declination = -75; declination <= 75; declination += 15) {
    const path: Vec3[] = [];
    for (let ra = 0; ra <= 24; ra += 0.125) path.push(equatorialToDirection(ra, declination));
    paths.push(path);
  }
  for (let ra = 0; ra < 24; ra += 1) {
    const path: Vec3[] = [];
    for (let declination = -90; declination <= 90; declination += 3)
      path.push(equatorialToDirection(ra, declination));
    paths.push(path);
  }
  return paths;
}

export class EnvironmentLayer {
  readonly group = new THREE.Group();
  readonly horizontalGrid: THREE.LineSegments;
  readonly equatorialGrid: THREE.LineSegments;

  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(uniforms: SkyUniforms) {
    const horizontalMaterial = lineMaterial(uniforms, 0x5b9eaa, 0.24, false);
    const equatorialMaterial = lineMaterial(uniforms, 0x8580b3, 0.25, true);
    const horizonMaterial = lineMaterial(uniforms, 0x82b4bd, 0.4, false);
    this.materials.push(horizontalMaterial, equatorialMaterial, horizonMaterial);

    const horizontalGeometry = segmentsGeometry(horizontalGridPaths());
    const equatorialGeometry = segmentsGeometry(equatorialGridPaths());
    const horizonGeometry = segmentsGeometry([
      [...Array.from({ length: 181 }, (_, index) => horizontalToWorld(index * 2, 0))],
    ]);
    this.geometries.push(horizontalGeometry, equatorialGeometry, horizonGeometry);
    this.horizontalGrid = new THREE.LineSegments(horizontalGeometry, horizontalMaterial);
    this.equatorialGrid = new THREE.LineSegments(equatorialGeometry, equatorialMaterial);
    const horizon = new THREE.LineSegments(horizonGeometry, horizonMaterial);
    for (const lines of [this.horizontalGrid, this.equatorialGrid, horizon]) {
      lines.frustumCulled = false;
      this.group.add(lines);
    }
    this.horizontalGrid.visible = false;
    this.equatorialGrid.visible = false;
    this.horizontalGrid.renderOrder = 8;
    this.equatorialGrid.renderOrder = 8;
    horizon.renderOrder = 21;

    const groundGeometry = new THREE.PlaneGeometry(2, 2);
    const groundMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: groundVertexShader,
      fragmentShader: groundFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.geometries.push(groundGeometry);
    this.materials.push(groundMaterial);
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.frustumCulled = false;
    ground.renderOrder = 20;
    this.group.add(ground);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.clear();
  }
}
