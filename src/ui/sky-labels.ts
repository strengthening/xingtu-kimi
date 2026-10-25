import { eqjToWorld, type ObservationFrame } from '../astro/coordinates.ts';
import type { Vec3 } from '../astro/math.ts';
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

function projectedLabel(
  id: string,
  text: string,
  record: StarRecord,
  className: string,
  priority: number,
  options: SkyLabelOptions,
): LabelRequest {
  const worldDirection = apparentRecordWorld(record, options.frame);
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
