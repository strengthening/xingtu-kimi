import './styles.css';
import { createObservationFrame, horizontalToWorld } from './astro/coordinates.ts';
import { SimulationClock } from './astro/time.ts';
import { StarCatalog } from './data/star-catalog.ts';
import { SkyRenderer } from './render/sky-renderer.ts';
import { requiredElement } from './ui/dom.ts';
import { LabelOverlay, type LabelRequest } from './ui/label-overlay.ts';
import { ObservationControls } from './ui/observation-controls.ts';

const canvas = requiredElement<HTMLCanvasElement>('sky-canvas');
const loadingScreen = requiredElement('loading-screen');
const loadingMessage = requiredElement('loading-message');
const loadingProgress = requiredElement('loading-progress');
const statusText = requiredElement('status-text');
const viewDirection = requiredElement('view-direction');
const viewFov = requiredElement('view-fov');
const resetView = requiredElement<HTMLButtonElement>('reset-view');
const atmosphereInput = requiredElement<HTMLInputElement>('atmosphere-input');
const atmosphereValue = requiredElement<HTMLOutputElement>('atmosphere-value');
const horizontalToggle = requiredElement<HTMLInputElement>('horizontal-toggle');
const equatorialToggle = requiredElement<HTMLInputElement>('equatorial-toggle');
const panelToggle = requiredElement<HTMLButtonElement>('panel-toggle');
const controlPanel = requiredElement('control-panel');
const clock = new SimulationClock();
let disposeApplication = () => undefined;

async function bootstrap(): Promise<void> {
  const catalog = new StarCatalog();
  const renderer = new SkyRenderer(canvas, catalog);
  const labels = new LabelOverlay(requiredElement('labels'));
  let frameDirty = true;
  const controls = new ObservationControls(clock, () => {
    frameDirty = true;
  });
  let animationFrame = 0;
  let loadingTimer = 0;
  let disposed = false;

  const reset = (): void => renderer.view.reset();
  resetView.addEventListener('click', reset);
  const togglePanel = (): void => {
    const closed = controlPanel.classList.toggle('closed');
    panelToggle.setAttribute('aria-expanded', String(!closed));
  };
  panelToggle.addEventListener('click', togglePanel);
  const updateAtmosphere = (): void => {
    const density = Number(atmosphereInput.value) / 100;
    renderer.setAtmosphere(density);
    atmosphereValue.value = `${atmosphereInput.value}%`;
    atmosphereInput.style.background = `linear-gradient(90deg, var(--accent) ${atmosphereInput.value}%, #2b3948 ${atmosphereInput.value}%)`;
  };
  atmosphereInput.addEventListener('input', updateAtmosphere);
  updateAtmosphere();
  const updateGrids = (): void => {
    renderer.environment.horizontalGrid.visible = horizontalToggle.checked;
    renderer.environment.equatorialGrid.visible = equatorialToggle.checked;
  };
  horizontalToggle.addEventListener('change', updateGrids);
  equatorialToggle.addEventListener('change', updateGrids);
  updateGrids();

  catalog.onProgress = ({ pending, loadedStars, totalStars }) => {
    statusText.textContent =
      pending > 0 ? `载入天区 · ${pending} 个分块` : `${loadedStars.toLocaleString()} 颗恒星已缓存`;
    if (loadedStars === 0)
      loadingMessage.textContent = `准备 ${totalStars.toLocaleString()} 颗真实恒星…`;
  };
  catalog.onError = (error) => {
    statusText.textContent = error.message;
    requiredElement('sky-status').classList.add('error');
  };
  renderer.onContextStatus = (available) => {
    statusText.textContent = available ? '图形上下文已恢复' : 'WebGL 上下文已丢失，等待恢复';
    requiredElement('sky-status').classList.toggle('error', !available);
  };

  disposeApplication = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    window.clearTimeout(loadingTimer);
    resetView.removeEventListener('click', reset);
    panelToggle.removeEventListener('click', togglePanel);
    atmosphereInput.removeEventListener('input', updateAtmosphere);
    horizontalToggle.removeEventListener('change', updateGrids);
    equatorialToggle.removeEventListener('change', updateGrids);
    controls.dispose();
    labels.dispose();
    renderer.dispose();
    catalog.dispose();
  };

  try {
    loadingMessage.textContent = '读取 Tycho-2 星表目录…';
    await catalog.initialize();
    loadingProgress.style.width = '32%';
    let frame = createObservationFrame(clock.date, controls.location);
    loadingMessage.textContent = '载入当前视场恒星…';
    await renderer.loadVisibleStars(frame);
    loadingProgress.style.width = '100%';
    loadingMessage.textContent = '天球已就绪';
    loadingScreen.classList.add('complete');
    loadingTimer = window.setTimeout(() => {
      loadingScreen.hidden = true;
    }, 550);
    requiredElement('sky-status').classList.remove('error');
    statusText.textContent = `Tycho-2 · ${catalog.manifest.totalStars.toLocaleString()} 颗真实恒星`;

    let lastFrameUpdate = -Infinity;
    let lastReadoutUpdate = -Infinity;
    clock.resetRealTime();
    const animate = (realTime: number): void => {
      const date = clock.tick(realTime);
      if (frameDirty || realTime - lastFrameUpdate >= 100) {
        frame = createObservationFrame(date, controls.location);
        frameDirty = false;
        lastFrameUpdate = realTime;
      }
      renderer.render(frame, realTime);
      if (realTime - lastReadoutUpdate >= 100) {
        controls.update();
        viewDirection.textContent = `方位 ${renderer.view.azimuth.toFixed(1)}° · 高度 ${renderer.view.altitude.toFixed(1)}°`;
        viewFov.textContent = `视场 ${renderer.view.fov.toFixed(1)}°`;
        const cardinals: LabelRequest[] = [
          { id: 'north', text: '北 N', azimuth: 0, className: 'sky-label cardinal north' },
          { id: 'east', text: '东 E', azimuth: 90, className: 'sky-label cardinal' },
          { id: 'south', text: '南 S', azimuth: 180, className: 'sky-label cardinal' },
          { id: 'west', text: '西 W', azimuth: 270, className: 'sky-label cardinal' },
        ].map(({ azimuth, ...label }) => {
          const point = renderer.project(horizontalToWorld(azimuth, 1.5));
          return { ...label, ...point, priority: 100, collide: false };
        });
        labels.update(cardinals);
        lastReadoutUpdate = realTime;
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadingScreen.hidden = false;
    loadingScreen.classList.remove('complete');
    loadingMessage.textContent = message;
    statusText.textContent = '星图启动失败';
    requiredElement('sky-status').classList.add('error');
    throw error;
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => disposeApplication());

void bootstrap().catch((error: unknown) => {
  console.error(error);
});
