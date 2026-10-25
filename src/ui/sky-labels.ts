import { eqjToWorld, type ObservationFrame } from '../astro/coordinates.ts';
import { normalize, type Vec3 } from '../astro/math.ts';
import { apparentStarDirection } from '../astro/stars.ts';
import type { ConstellationCatalog, NameCatalog, StarRecord } from '../data/catalog.ts';
import type { LabelRequest } from './label-overlay.ts';

interface SkyLabelOptions {
  frame: ObservationFrame;
  fov: number;
  names: NameCatalog;
  constellations: ConstellationCatalog;
  showModern: boolean;
  showChinese: boolean;
  project: (worldDirection: Vec3) => { x: number; y: number; visible: boolean };
}

const ENCLOSURES: ReadonlyArray<{ name: string; walls: readonly string[] }> = [
  { name: '紫微垣', walls: ['紫微左垣', '紫微右垣'] },
  { name: '太微垣', walls: ['太微左垣', '太微右垣'] },
  { name: '天市垣', walls: ['天市左垣', '天市右垣'] },
];

export function labelMagnitudeLimit(fov: number): number {
  if (fov >= 45) return 2;
  if (fov >= 25) return 3;
  if (fov >= 12) return 4;
  if (fov >= 6) return 5;
  if (fov >= 3) return 6;
  return 7;
}

function apparentRecordWorld(record: StarRecord, frame: ObservationFrame): Vec3 {
  return eqjToWorld(
    apparentStarDirection([record[0], record[1], record[2]], record[3], record[4], frame),
    frame,
  );
}

function directionLabel(
  id: string,
  text: string,
  worldDirection: Vec3,
  className: string,
  priority: number,
  options: SkyLabelOptions,
): LabelRequest {
  const point = options.project(worldDirection);
  return {
    id,
    text,
    ...point,
    visible: point.visible && worldDirection[1] > 0.005,
    className,
    priority,
  };
}

function projectedLabel(
  id: string,
  text: string,
  record: StarRecord,
  className: string,
  priority: number,
  options: SkyLabelOptions,
): LabelRequest {
  return directionLabel(
    id,
    text,
    apparentRecordWorld(record, options.frame),
    className,
    priority,
    options,
  );
}

function createEnclosureLabels(options: SkyLabelOptions): LabelRequest[] {
  const requests: LabelRequest[] = [];
  for (const enclosure of ENCLOSURES) {
    const hips = new Set<number>();
    for (const figure of options.constellations.cultures.chinese) {
      if (!enclosure.walls.includes(figure.native)) continue;
      for (const segment of figure.segments) {
        hips.add(segment[0]);
        hips.add(segment[1]);
      }
    }
    const center: Vec3 = [0, 0, 0];
    let count = 0;
    for (const hip of hips) {
      const record = options.constellations.stars[String(hip)];
      if (!record) continue;
      const direction = apparentRecordWorld(record, options.frame);
      center[0] += direction[0];
      center[1] += direction[1];
      center[2] += direction[2];
      count += 1;
    }
    if (count === 0) continue;
    requests.push(
      directionLabel(
        `chinese-enclosure-${enclosure.name}`,
        enclosure.name,
        normalize(center),
        'sky-label constellation enclosure',
        18,
        options,
      ),
    );
  }
  return requests;
}

export function createSkyLabels(options: SkyLabelOptions): LabelRequest[] {
  const requests: LabelRequest[] = [];
  const magnitudeLimit = labelMagnitudeLimit(options.fov);
  for (const star of options.names.stars) {
    const magnitude = star.record[5];
    if (magnitude >= magnitudeLimit) continue;
    requests.push(
      projectedLabel(
        `star-${star.hip}`,
        star.name,
        star.record,
        `sky-label${magnitude < 2 ? ' bright' : ''}`,
        35 - magnitude,
        options,
      ),
    );
  }

  const figures: Array<{
    figure: ConstellationCatalog['cultures']['modern'][number];
    culture: 'modern' | 'chinese';
  }> = [];
  if (options.showModern) {
    figures.push(
      ...options.constellations.cultures.modern.map((figure) => ({
        figure,
        culture: 'modern' as const,
      })),
    );
  }
  if (options.showChinese) {
    figures.push(
      ...options.constellations.cultures.chinese.map((figure) => ({
        figure,
        culture: 'chinese' as const,
      })),
    );
  }
  for (const { figure, culture } of figures) {
    const record = options.constellations.stars[String(figure.labelHip)];
    if (!record) continue;
    requests.push(
      projectedLabel(
        `${culture}-${figure.id}`,
        figure.native,
        record,
        `sky-label constellation ${culture}`,
        culture === 'chinese' ? 12 : 10,
        options,
      ),
    );
  }

  if (options.showChinese) {
    requests.push(...createEnclosureLabels(options));
    for (const mansion of options.constellations.lunarMansions) {
      const record = options.constellations.stars[String(mansion.hip)];
      if (!record) continue;
      const name = mansion.native.endsWith('宿') ? mansion.native : `${mansion.native}宿`;
      requests.push(
        projectedLabel(
          `mansion-${mansion.hip}`,
          name,
          record,
          'sky-label constellation mansion',
          16,
          options,
        ),
      );
    }
  }
  return requests;
}
