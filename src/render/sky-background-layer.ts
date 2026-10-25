import * as THREE from 'three';
import type { HipsSurvey } from '../data/hips-client.ts';
import { atmosphereFunction, skyShaderDeclarations } from './shaders.ts';
import type { SkyUniforms } from './sky-uniforms.ts';

const vertexShader = /* glsl */ `
  ${skyShaderDeclarations}
  uniform mat3 uEqjToWorld;
  varying vec3 vWorldDirection;

  void main() {
    vec3 worldDirection = normalize(uEqjToWorld * position);
    vWorldDirection = worldDirection;
    gl_Position = skyClipFromWorld(worldDirection);
  }
`;

const fragmentShader = /* glsl */ `
  ${atmosphereFunction}
  uniform mat3 uEqjToWorld;
  uniform sampler2D uSurvey;
  uniform float uSurveyReady;
  uniform float uSurveyEnabled;
  uniform float uDaylight;
  uniform float uMoonlight;
  varying vec3 vWorldDirection;

  void main() {
    vec3 worldDirection = normalize(vWorldDirection);
    vec3 equatorial = normalize(transpose(uEqjToWorld) * worldDirection);
    vec2 surveyUv = vec2(
      atan(equatorial.y, equatorial.x) / 6.28318530718 + 0.5,
      asin(clamp(equatorial.z, -1.0, 1.0)) / 3.14159265359 + 0.5
    );
    float altitude = degrees(asin(clamp(worldDirection.y, -1.0, 1.0)));
    float transmission = skyTransmission(altitude);
    float daylight = pow(clamp(uDaylight, 0.0, 1.0), 0.7);
    float horizon = pow(1.0 - abs(worldDirection.y), 4.0);
    vec3 zenith = vec3(0.055, 0.19, 0.43);
    vec3 horizonColor = vec3(0.31, 0.43, 0.56);
    vec3 dayColor = mix(zenith, horizonColor, horizon * 0.82);
    vec3 color = mix(vec3(0.0015, 0.003, 0.008), dayColor, daylight);
    color += vec3(0.22, 0.30, 0.45) * uMoonlight * (1.0 - daylight);

    float surveyVisibility = uSurveyReady * uSurveyEnabled;
    surveyVisibility *= 1.0 - smoothstep(0.02, 0.4, uDaylight);
    surveyVisibility *= 1.0 - clamp(uMoonlight * 6.0, 0.0, 0.8);
    surveyVisibility *= 0.3 + 0.7 * transmission;
    vec3 survey = texture2D(uSurvey, surveyUv).rgb;
    color += survey * surveyVisibility * 0.42;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export class SkyBackgroundLayer {
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.SphereGeometry(1, 192, 96);
  private readonly surveyUniform: { value: THREE.DataTexture | null } = { value: null };
  private readonly surveyReadyUniform = { value: 0 };
  private readonly surveyEnabledUniform = { value: 1 };
  private texture: THREE.DataTexture | undefined;

  constructor(uniforms: SkyUniforms) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uSurvey: this.surveyUniform,
        uSurveyReady: this.surveyReadyUniform,
        uSurveyEnabled: this.surveyEnabledUniform,
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  setSurvey(survey: HipsSurvey): void {
    this.texture?.dispose();
    const texture = new THREE.DataTexture(
      survey.data,
      survey.width,
      survey.height,
      THREE.RGBAFormat,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.texture = texture;
    this.surveyUniform.value = texture;
    this.surveyReadyUniform.value = 1;
  }

  setSurveyEnabled(enabled: boolean): void {
    this.surveyEnabledUniform.value = enabled ? 1 : 0;
  }

  dispose(): void {
    this.texture?.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
