import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ConstellationCatalog,
  ConstellationFigure,
  ReferenceStarCatalog,
  StarRecord,
} from '../src/data/catalog.ts';
import { loadSkyCultureInputs, type SkyFigure } from './sky-culture.ts';

const root = process.cwd();
const cultures = await loadSkyCultureInputs(root);
const references = JSON.parse(
  await readFile(path.join(root, 'public/data/reference-stars.json'), 'utf8'),
) as ReferenceStarCatalog;
const usedHips = new Set<number>();
let unsupportedIdentifiers = 0;
let missingHipReferences = 0;

function recordFor(hip: number): StarRecord | undefined {
  return references.stars[String(hip)];
}

function buildFigure(figure: SkyFigure): ConstellationFigure | undefined {
  const segments: Array<[number, number]> = [];
  const seen = new Set<string>();
  const numericIdentifiers = (figure.lines ?? [])
    .flat()
    .filter((identifier): identifier is number => typeof identifier === 'number');
  const labelHip = numericIdentifiers.find((hip) => Boolean(recordFor(hip))) ?? 0;
  for (const path of figure.lines ?? []) {
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const to = path[index];
      if (typeof from !== 'number' || typeof to !== 'number') {
        unsupportedIdentifiers += 1;
        continue;
      }
      if (from === to || !recordFor(from) || !recordFor(to)) {
        missingHipReferences += 1;
        continue;
      }
      const key = `${from}:${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push([from, to]);
      usedHips.add(from);
      usedHips.add(to);
    }
  }
  if (segments.length === 0 && !labelHip) return undefined;
  if (labelHip) usedHips.add(labelHip);
  const english = figure.common_name?.english ?? figure.common_name?.native ?? figure.id;
  const native = figure.common_name?.native ?? english;
  const pronunciation = figure.common_name?.pronounce;
  return {
    id: figure.id,
    english,
    native,
    ...(pronunciation ? { pronunciation } : {}),
    segments,
    labelHip,
  };
}

function buildFigures(figures: SkyFigure[] | undefined): ConstellationFigure[] {
  return (figures ?? [])
    .map((figure) => buildFigure(figure))
    .filter((figure): figure is ConstellationFigure => figure !== undefined);
}

const modern = buildFigures(cultures.modern.constellations);
const chinese = buildFigures(cultures.chinese.constellations);
const definingStars = cultures.chinese.lunar_system?.defining_stars ?? [];
const mansionNames = cultures.chinese.lunar_system?.names ?? [];
const lunarMansions: ConstellationCatalog['lunarMansions'] = [];
for (let index = 0; index < definingStars.length; index += 1) {
  const hip = definingStars[index];
  const name = mansionNames[index];
  if (hip === undefined || !name || !recordFor(hip)) continue;
  usedHips.add(hip);
  const english = name.english ?? name.native ?? `Lunar mansion ${index + 1}`;
  lunarMansions.push({
    hip,
    english,
    native: name.native ?? english,
    ...(name.pronounce ? { pronunciation: name.pronounce } : {}),
    ...(name.symbol ? { symbol: name.symbol } : {}),
  });
}

if (modern.length !== 88) throw new Error(`Expected 88 IAU constellations, built ${modern.length}`);
if (lunarMansions.length !== 28) {
  throw new Error(`Expected 28 lunar mansions, built ${lunarMansions.length}`);
}

const stars: Record<string, StarRecord> = {};
for (const hip of usedHips) {
  const record = recordFor(hip);
  if (record) stars[String(hip)] = record;
}
const catalog: ConstellationCatalog = {
  version: 1,
  stars,
  cultures: { modern, chinese },
  lunarMansions,
};
await mkdir(path.join(root, 'public/data'), { recursive: true });
await writeFile(path.join(root, 'public/data/constellations.json'), JSON.stringify(catalog));
console.log(
  JSON.stringify(
    {
      modernFigures: modern.length,
      chineseFigures: chinese.length,
      lunarMansions: lunarMansions.length,
      referencedStars: usedHips.size,
      modernSegments: modern.reduce((sum, figure) => sum + figure.segments.length, 0),
      chineseSegments: chinese.reduce((sum, figure) => sum + figure.segments.length, 0),
      unsupportedIdentifiers,
      missingHipReferences,
      bytes: Buffer.byteLength(JSON.stringify(catalog)),
    },
    null,
    2,
  ),
);
