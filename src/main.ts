import './styles.css';
import { createObservationFrame } from './astro/coordinates.ts';
import { SimulationClock } from './astro/time.ts';
import { StarCatalog } from './data/star-catalog.ts';
import { SkyRenderer } from './render/sky-renderer.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element #${id}`);
  return found as T;
}

const canvas = element<HTMLCanvasElement>('sky-canvas');
const loadingScreen = element('loading-screen');
const loadingMessage = element('loading-message');
const loadingProgress = element('loading-progress');
const statusText = element('status-text');
const viewDirection = element('view-direction');
const viewFov = element('view-fov');
const resetView = element<HTMLButtonElement>('reset-view');
const atmosphereInput = element<HTMLInputElement>('atmosphere-input');
const atmosphereValue = element<HTMLOutputElement>('atmosphere-value');
const location = { latitude: 31.23, longitude: 121.47 };
const clock = new SimulationClock();
let disposeApplication = () => undefined;

async function bootstrap(): Promise<void> {
  const catalog = new StarCatalog();
  const renderer = new SkyRenderer(canvas, catalog);
  let animationFrame = 0;
  let loadingTimer = 0;
  let disposed = false;

  const reset = (): void => renderer.view.reset();
  resetView.addEventListener('click', reset);
  const updateAtmosphere = (): void => {
    const density = Number(atmosphereInput.value) / 100;
    renderer.setAtmosphere(density);
    atmosphereValue.value = `${atmosphereInput.value}%`;
    atmosphereInput.style.background = `linear-gradient(90deg, var(--accent) ${atmosphereInput.value}%, #2b3948 ${atmosphereInput.value}%)`;
  };
  atmosphereInput.addEventListener('input', updateAtmosphere);
  updateAtmosphere();

  catalog.onProgress = ({ pending, loadedStars, totalStars }) => {
    statusText.textContent =
      pending > 0 ? `载入天区 · ${pending} 个分块` : `${loadedStars.toLocaleString()} 颗恒星已缓存`;
    if (loadedStars === 0)
      loadingMessage.textContent = `准备 ${totalStars.toLocaleString()} 颗真实恒星…`;
  };
  catalog.onError = (error) => {
    statusText.textContent = error.message;
    element('sky-status').classList.add('error');
  };
  renderer.onContextStatus = (available) => {
    statusText.textContent = available ? '图形上下文已恢复' : 'WebGL 上下文已丢失，等待恢复';
    element('sky-status').classList.toggle('error', !available);
  };

  disposeApplication = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    window.clearTimeout(loadingTimer);
    resetView.removeEventListener('click', reset);
    atmosphereInput.removeEventListener('input', updateAtmosphere);
    renderer.dispose();
    catalog.dispose();
  };

  try {
    loadingMessage.textContent = '读取 Tycho-2 星表目录…';
    await catalog.initialize();
    loadingProgress.style.width = '32%';
    let frame = createObservationFrame(clock.date, location);
    loadingMessage.textContent = '载入当前视场恒星…';
    await renderer.loadVisibleStars(frame);
    loadingProgress.style.width = '100%';
    loadingMessage.textContent = '天球已就绪';
    loadingScreen.classList.add('complete');
    loadingTimer = window.setTimeout(() => {
      loadingScreen.hidden = true;
    }, 550);
    element('sky-status').classList.remove('error');
    statusText.textContent = `Tycho-2 · ${catalog.manifest.totalStars.toLocaleString()} 颗真实恒星`;

    let lastFrameUpdate = -Infinity;
    let lastReadoutUpdate = -Infinity;
    clock.resetRealTime();
    const animate = (realTime: number): void => {
      const date = clock.tick(realTime);
      if (realTime - lastFrameUpdate >= 100) {
        frame = createObservationFrame(date, location);
        lastFrameUpdate = realTime;
      }
      renderer.render(frame, realTime);
      if (realTime - lastReadoutUpdate >= 100) {
        viewDirection.textContent = `方位 ${renderer.view.azimuth.toFixed(1)}° · 高度 ${renderer.view.altitude.toFixed(1)}°`;
        viewFov.textContent = `视场 ${renderer.view.fov.toFixed(1)}°`;
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
    element('sky-status').classList.add('error');
    throw error;
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => disposeApplication());

void bootstrap().catch((error: unknown) => {
  console.error(error);
});
