import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface SkyName {
  english?: string;
  native?: string;
  pronounce?: string;
}

export interface SkyFigure {
  id: string;
  common_name?: SkyName;
  lines?: Array<Array<number | string>>;
}

export interface LunarMansion {
  english?: string;
  native?: string;
  pronounce?: string;
  symbol?: string;
}

export interface SkyCultureSource {
  common_names?: Record<string, SkyName[]>;
  constellations?: SkyFigure[];
  lunar_system?: {
    defining_stars?: number[];
    names?: LunarMansion[];
  };
}

export interface MergedName {
  english: string;
  native: string;
  pronunciation?: string;
}

export interface SkyCultureInputs {
  modern: SkyCultureSource;
  chinese: SkyCultureSource;
  names: Map<number, MergedName>;
  requiredHips: Set<number>;
}

async function readCulture(root: string, culture: string): Promise<SkyCultureSource> {
  const file = path.join(root, `data/raw/skycultures/${culture}-index.json`);
  return JSON.parse(await readFile(file, 'utf8')) as SkyCultureSource;
}

function hipFromKey(key: string): number | undefined {
  const match = /^HIP\s+(\d+)$/.exec(key);
  if (!match) return undefined;
  const hip = Number(match[1]);
  return Number.isInteger(hip) && hip > 0 ? hip : undefined;
}

function preferredName(names: SkyName[] | undefined): SkyName | undefined {
  return names?.find((name) => Boolean(name.native || name.english));
}

export async function loadSkyCultureInputs(root: string): Promise<SkyCultureInputs> {
  const [modern, chinese] = await Promise.all([
    readCulture(root, 'modern'),
    readCulture(root, 'chinese'),
  ]);
  const names = new Map<number, MergedName>();
  const requiredHips = new Set<number>();

  for (const [key, entries] of Object.entries(modern.common_names ?? {})) {
    const hip = hipFromKey(key);
    const name = preferredName(entries);
    if (!hip || !name) continue;
    const english = name.english ?? name.native ?? '';
    const native = name.native ?? english;
    if (english || native) names.set(hip, { english, native });
    requiredHips.add(hip);
  }

  for (const [key, entries] of Object.entries(chinese.common_names ?? {})) {
    const hip = hipFromKey(key);
    const name = preferredName(entries);
    if (!hip || !name) continue;
    const previous = names.get(hip);
    const native = name.native ?? previous?.native ?? name.english ?? '';
    const english = previous?.english || name.english || native;
    const pronunciation = name.pronounce ?? previous?.pronunciation;
    names.set(hip, {
      english,
      native,
      ...(pronunciation ? { pronunciation } : {}),
    });
    requiredHips.add(hip);
  }

  for (const culture of [modern, chinese]) {
    for (const figure of culture.constellations ?? []) {
      for (const path of figure.lines ?? []) {
        for (const identifier of path) {
          if (typeof identifier === 'number' && Number.isInteger(identifier) && identifier > 0) {
            requiredHips.add(identifier);
          }
        }
      }
    }
    for (const hip of culture.lunar_system?.defining_stars ?? []) requiredHips.add(hip);
  }

  return { modern, chinese, names, requiredHips };
}
