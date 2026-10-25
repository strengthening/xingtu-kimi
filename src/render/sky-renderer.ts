import * as THREE from 'three';
import type { ObservationFrame } from '../astro/coordinates.ts';
import { stereographicScale } from '../astro/projection.ts';
import type { Vec3 } from '../astro/math.ts';
import type { StarCatalog } from '../data/star-catalog.ts';
import { createSkyUniforms } from './sky-uniforms.ts';
import { StarLayer } from './star-layer.ts';
import { ViewController } from './view-controller.ts';

export class SkyRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.001, 10);
  readonly view: ViewController;
  readonly stars: StarLayer;
  readonly uniforms = createSkyUniforms();
  onContextStatus: ((available: boolean) => void) | undefined;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private aspect = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    catalog: StarCatalog,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x01040b, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0, 0);
    this.view = new ViewController(canvas);
    this.stars = new StarLayer(catalog, this.uniforms, this.view);
    this.scene.add(this.stars.group);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.resize();
  }

  async loadVisibleStars(frame: ObservationFrame): Promise<void> {
    await this.stars.loadVisible(frame, this.aspect);
  }

  render(frame: ObservationFrame, realTime: number): void {
    this.view.update(realTime);
    this.uniforms.uEqjToWorld.value.set(...frame.eqjToWorld);
    this.uniforms.uWorldToView.value.set(...this.view.worldToView);
    this.uniforms.uEarthVelocity.value.set(...frame.earthVelocity);
    this.uniforms.uYearsSinceJ2000.value = frame.yearsSinceJ2000;
    this.uniforms.uFovScale.value = stereographicScale(this.view.fov);
    this.uniforms.uAspect.value = this.aspect;
    this.uniforms.uFov.value = this.view.fov;
    this.stars.sync(frame, this.aspect);
    this.renderer.render(this.scene, this.camera);
  }

  setAtmosphere(density: number): void {
    this.uniforms.uAtmosphere.value = THREE.MathUtils.clamp(density, 0, 1);
  }

  project(worldDirection: Vec3): { x: number; y: number; visible: boolean } {
    return this.view.project(worldDirection, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.view.dispose();
    this.stars.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    this.renderer.dispose();
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.aspect = width / height;
    this.uniforms.uPixelRatio.value = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.stars?.invalidate();
  };

  private readonly contextLost = (event: Event): void => {
    event.preventDefault();
    this.onContextStatus?.(false);
  };

  private readonly contextRestored = (): void => {
    this.stars.invalidate();
    this.onContextStatus?.(true);
  };
}
