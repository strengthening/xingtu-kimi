import './styles.css';
import { createObservationFrame, horizontalToWorld } from './astro/coordinates.ts';
import { SimulationClock } from './astro/time.ts';
import type { NamedStar } from './data/catalog.ts';
import { HipsClient } from './data/hips-client.ts';
import { LOCATION_PRESETS } from './data/locations.ts';
import { loadSkyMetadata } from './data/sky-metadata.ts';
import { StarCatalog } from './data/star-catalog.ts';
import { pickSkyTarget, resolveSkyTarget, type SkyTarget } from './render/picking.ts';
import { SkyRenderer } from './render/sky-renderer.ts';
import { requiredElement } from './ui/dom.ts';
import { InfoCard } from './ui/info-card.ts';
import { LabelOverlay, type LabelRequest } from './ui/label-overlay.ts';
import { ObservationControls } from './ui/observation-controls.ts';
import { createSceneUrl, parseSceneUrl } from './ui/scene-url.ts';
import { createSkyLabels } from './ui/sky-labels.ts';

const canvas = requiredElement<HTMLCanvasElement>('sky-canvas');
const loadingScreen = requiredElement('loading-screen');
const loadingMessage = requiredElement('loading-message');
const loadingProgress = requiredElement('loading-progress');
const statusText = requiredElement('status-text');
const viewDirection = requiredElement('view-direction');
const viewFov = requiredElement('view-fov');
const resetView = requiredElement<HTMLButtonElement>('reset-view');
const locationSelect = requiredElement<HTMLSelectElement>('location-select');
const atmosphereInput = requiredElement<HTMLInputElement>('atmosphere-input');
const atmosphereValue = requiredElement<HTMLOutputElement>('atmosphere-value');
const chineseToggle = requiredElement<HTMLInputElement>('chinese-toggle');
const modernToggle = requiredElement<HTMLInputElement>('modern-toggle');
const horizontalToggle = requiredElement<HTMLInputElement>('horizontal-toggle');
const equatorialToggle = requiredElement<HTMLInputElement>('equatorial-toggle');
const hipsToggle = requiredElement<HTMLInputElement>('hips-toggle');
const labelsToggle = requiredElement<HTMLInputElement>('labels-toggle');
const shareButton = requiredElement<HTMLButtonElement>('share-button');
const panelToggle = requiredElement<HTMLButtonElement>('panel-toggle');
const controlPanel = requiredElement('control-panel');
const selectionMarker = requiredElement('selection-marker');
const licenseButton = requiredElement<HTMLButtonElement>('license-button');
const licenseDialog = requiredElement<HTMLDialogElement>('license-dialog');
const licenseClose = requiredElement<HTMLButtonElement>('license-close');
const toast = requiredElement('toast');
const clock = new SimulationClock();
let disposeApplication = () => undefined;

async function copyText(text: string): Promise<void> {
  const copiedWithClipboard = navigator.clipboard
    ? await navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      )
    : false;
  if (copiedWithClipboard) return;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

async function bootstrap(): Promise<void> {
  let sharedScene: ReturnType<typeof parseSceneUrl> = undefined;
  let invalidSharedScene = false;
  try {
    sharedScene = parseSceneUrl(window.location.href);
  } catch {
    invalidSharedScene = true;
  }
  if (sharedScene) {
    clock.setDate(sharedScene.date);
    clock.setRate(sharedScene.rate);
    clock.setPlaying(sharedScene.playing);
  }

  const catalog = new StarCatalog();
  const hips = new HipsClient();
  const metadataAbort = new AbortController();
  const renderer = new SkyRenderer(canvas, catalog);
  const labels = new LabelOverlay(requiredElement('labels'));
  let frameDirty = true;
  const controls = new ObservationControls(clock, () => {
    frameDirty = true;
  });
  if (sharedScene) {
    const preset = LOCATION_PRESETS.find(
      (candidate) =>
        Math.abs(candidate.latitude - sharedScene.location.latitude) < 0.00001 &&
        Math.abs(candidate.longitude - sharedScene.location.longitude) < 0.00001,
    );
    controls.setLocation(sharedScene.location, preset?.name ?? '自定义经纬度', preset?.timeZone);
    locationSelect.value = preset?.id ?? 'custom';
    renderer.view.setState(sharedScene.view);
    chineseToggle.checked = sharedScene.display.chinese;
    modernToggle.checked = sharedScene.display.modern;
    horizontalToggle.checked = sharedScene.display.horizontal;
    equatorialToggle.checked = sharedScene.display.equatorial;
    hipsToggle.checked = sharedScene.display.hips;
    labelsToggle.checked = sharedScene.display.labels;
    atmosphereInput.value = String(sharedScene.display.atmosphere);
  }

  let frame = createObservationFrame(clock.date, controls.location);
  let namesByHip: ReadonlyMap<number, NamedStar> = new Map();
  let selection: SkyTarget | undefined;
  let animationFrame = 0;
  let loadingTimer = 0;
  let toastTimer = 0;
  let disposed = false;
  let hipsPromise: Promise<void> | undefined;

  const showToast = (message: string): void => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  };
  const updateSelection = (): void => {
    if (!selection) {
      infoCard.hide();
      selectionMarker.hidden = true;
      return;
    }
    const resolved = resolveSkyTarget(selection, frame, renderer.solarBodies);
    infoCard.show(resolved);
    const point = renderer.project(resolved.worldDirection);
    selectionMarker.style.left = `${point.x.toFixed(1)}px`;
    selectionMarker.style.top = `${point.y.toFixed(1)}px`;
    selectionMarker.hidden = !point.visible || resolved.worldDirection[1] < -0.009;
  };
  const infoCard = new InfoCard(() => {
    selection = undefined;
    selectionMarker.hidden = true;
  });
  renderer.view.onClick = (clientX, clientY) => {
    const bounds = canvas.getBoundingClientRect();
    selection = pickSkyTarget({
      x: clientX - bounds.left,
      y: clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
      fov: renderer.view.fov,
      worldToView: renderer.view.worldToView,
      frame,
      chunks: catalog.loadedChunks(),
      bodies: renderer.solarBodies,
      names: namesByHip,
    });
    updateSelection();
  };

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
  const updateConstellations = (): void => {
    renderer.constellations.setVisible('chinese', chineseToggle.checked);
    renderer.constellations.setVisible('modern', modernToggle.checked);
  };
  chineseToggle.addEventListener('change', updateConstellations);
  modernToggle.addEventListener('change', updateConstellations);

  const share = (): void => {
    const url = createSceneUrl(window.location.href, {
      location: controls.location,
      date: clock.date,
      view: renderer.view.state,
      playing: clock.playing,
      rate: clock.rate,
      display: {
        chinese: chineseToggle.checked,
        modern: modernToggle.checked,
        horizontal: horizontalToggle.checked,
        equatorial: equatorialToggle.checked,
        hips: hipsToggle.checked,
        labels: labelsToggle.checked,
        atmosphere: Number(atmosphereInput.value),
      },
    });
    void copyText(url).then(
      () => showToast('场景链接已复制，包含当前时间与视角'),
      () => showToast('复制失败，请检查浏览器剪贴板权限'),
    );
  };
  shareButton.addEventListener('click', share);
  const openLicense = (): void => licenseDialog.showModal();
  const closeLicense = (): void => licenseDialog.close();
  licenseButton.addEventListener('click', openLicense);
  licenseClose.addEventListener('click', closeLicense);

  const syncHips = (): void => {
    renderer.background.setSurveyEnabled(hipsToggle.checked);
    if (!hipsToggle.checked || hipsPromise) return;
    statusText.textContent = '连接 DSS2 HiPS 全天背景…';
    hipsPromise = hips
      .load()
      .then((survey) => {
        if (disposed) return;
        renderer.background.setSurvey(survey);
        if (hipsToggle.checked)
          statusText.textContent = `${survey.properties.title} · 全天背景已就绪`;
      })
      .catch((error: unknown) => {
        hipsPromise = undefined;
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
        const message = error instanceof Error ? error.message : String(error);
        statusText.textContent = `${message} · 已保留真实星图`;
      });
  };
  hips.onProgress = (loaded, total) => {
    if (hipsToggle.checked) statusText.textContent = `DSS2 HiPS · 载入切片 ${loaded}/${total}`;
  };
  hipsToggle.addEventListener('change', syncHips);

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
    window.clearTimeout(toastTimer);
    metadataAbort.abort();
    resetView.removeEventListener('click', reset);
    panelToggle.removeEventListener('click', togglePanel);
    atmosphereInput.removeEventListener('input', updateAtmosphere);
    chineseToggle.removeEventListener('change', updateConstellations);
    modernToggle.removeEventListener('change', updateConstellations);
    horizontalToggle.removeEventListener('change', updateGrids);
    equatorialToggle.removeEventListener('change', updateGrids);
    hipsToggle.removeEventListener('change', syncHips);
    shareButton.removeEventListener('click', share);
    licenseButton.removeEventListener('click', openLicense);
    licenseClose.removeEventListener('click', closeLicense);
    renderer.view.onClick = undefined;
    infoCard.dispose();
    controls.dispose();
    labels.dispose();
    hips.dispose();
    renderer.dispose();
    catalog.dispose();
  };

  try {
    loadingMessage.textContent = '读取星表、星名与星座目录…';
    const [, metadata] = await Promise.all([
      catalog.initialize(),
      loadSkyMetadata(metadataAbort.signal),
    ]);
    namesByHip = new Map(metadata.names.stars.map((star) => [star.hip, star]));
    renderer.constellations.setCatalog(metadata.constellations);
    updateConstellations();
    loadingProgress.style.width = '32%';
    frame = createObservationFrame(clock.date, controls.location);
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
    syncHips();
    if (invalidSharedScene) showToast('分享链接无效，已使用默认观测场景');

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
        const cultureLabels: LabelRequest[] = labelsToggle.checked
          ? createSkyLabels({
              frame,
              fov: renderer.view.fov,
              names: metadata.names,
              constellations: metadata.constellations,
              showModern: modernToggle.checked,
              showChinese: chineseToggle.checked,
              project: (worldDirection) => renderer.project(worldDirection),
            })
          : [];
        const bodyLabels: LabelRequest[] = labelsToggle.checked
          ? renderer.solarBodies.map((body, index) => {
              const point = renderer.project(body.worldDirection);
              return {
                id: `solar-${body.english}`,
                text: body.name,
                ...point,
                visible: point.visible && body.horizontal.altitude > -0.5,
                className: 'sky-label planet',
                priority: 90 - index,
              };
            })
          : [];
        labels.update([...cardinals, ...cultureLabels, ...bodyLabels]);
        updateSelection();
        lastReadoutUpdate = realTime;
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animate(performance.now());
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
