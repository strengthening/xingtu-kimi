import type { ConstellationCatalog, NameCatalog } from './catalog.ts';

export interface SkyMetadata {
  names: NameCatalog;
  constellations: ConstellationCatalog;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`星名与星座数据读取失败（HTTP ${response.status}）`);
  return (await response.json()) as unknown;
}

export async function loadSkyMetadata(
  signal: AbortSignal,
  baseUrl = '/data',
): Promise<SkyMetadata> {
  const [namesValue, constellationsValue] = await Promise.all([
    fetchJson(`${baseUrl}/names.json`, signal),
    fetchJson(`${baseUrl}/constellations.json`, signal),
  ]);
  const names = namesValue as Partial<NameCatalog>;
  const constellations = constellationsValue as Partial<ConstellationCatalog>;
  if (names.version !== 1 || !Array.isArray(names.stars)) {
    throw new Error('星名目录格式无效，请重新运行 pnpm data:build');
  }
  if (
    constellations.version !== 1 ||
    !constellations.stars ||
    !Array.isArray(constellations.cultures?.modern) ||
    !Array.isArray(constellations.cultures.chinese) ||
    !Array.isArray(constellations.lunarMansions)
  ) {
    throw new Error('星座目录格式无效，请重新运行 pnpm data:constellations');
  }
  return {
    names: names as NameCatalog,
    constellations: constellations as ConstellationCatalog,
  };
}
