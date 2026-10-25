import type { Body } from 'astronomy-engine';
import {
  apparentEquatorial,
  directionToEquatorial,
  eqjToWorld,
  worldToHorizontal,
  type EquatorialCoordinates,
  type HorizontalCoordinates,
  type ObservationFrame,
} from '../astro/coordinates.ts';
import { transform, type Mat3, type Vec3 } from '../astro/math.ts';
import { projectStereographic, stereographicScale } from '../astro/projection.ts';
import { apparentStarDirection } from '../astro/stars.ts';
import {
  STAR_FLOATS,
  StarField,
  tycDesignation,
  type NamedStar,
  type StarRecord,
} from '../data/catalog.ts';
import type { SolarBodyPosition } from '../astro/ephemeris.ts';

export type SkyTarget =
  | { kind: 'star'; record: StarRecord; named?: NamedStar }
  | { kind: 'solar'; body: Body };

export interface ResolvedStar {
  kind: 'star';
  name: string;
  english: string;
  hip: number;
  tyc: string;
  magnitude: number;
  colorIndex: number;
  j2000: EquatorialCoordinates;
  apparent: EquatorialCoordinates;
  horizontal: HorizontalCoordinates;
  worldDirection: Vec3;
}

export interface ResolvedSolarBody {
  kind: 'solar';
  body: SolarBodyPosition;
  worldDirection: Vec3;
}

export type ResolvedSkyTarget = ResolvedStar | ResolvedSolarBody;

interface PickingChunk {
  bin: { maxFov: number };
  data: Float32Array;
}

interface PickingInput {
  x: number;
  y: number;
  width: number;
  height: number;
  fov: number;
  worldToView: Mat3;
  frame: ObservationFrame;
  chunks: Iterable<PickingChunk>;
  bodies: SolarBodyPosition[];
  names: ReadonlyMap<number, NamedStar>;
}

function screenPoint(
  worldDirection: Vec3,
  input: PickingInput,
): { x: number; y: number; visible: boolean } {
  const viewDirection = transform(input.worldToView, worldDirection);
  const point = projectStereographic(viewDirection, input.fov, input.width / input.height);
  return {
    x: (point.x * 0.5 + 0.5) * input.width,
    y: (0.5 - point.y * 0.5) * input.height,
    visible: point.visible,
  };
}

function recordAt(data: Float32Array, offset: number): StarRecord {
  return Array.from({ length: STAR_FLOATS }, (_, index) => data[offset + index] ?? 0) as StarRecord;
}

export function pickSkyTarget(input: PickingInput): SkyTarget | undefined {
  let closestBody: { body: Body; distance: number } | undefined;
  for (const body of input.bodies) {
    if (body.horizontal.altitude < -0.5) continue;
    const point = screenPoint(body.worldDirection, input);
    if (!point.visible) continue;
    const distance = Math.hypot(point.x - input.x, point.y - input.y);
    const radius = Math.max(
      12,
      (body.angularRadius * input.height) / stereographicScale(input.fov),
    );
    if (distance <= radius && (!closestBody || distance < closestBody.distance)) {
      closestBody = { body: body.body, distance };
    }
  }
  if (closestBody) return { kind: 'solar', body: closestBody.body };

  let closestStar: { record: StarRecord; distanceSquared: number } | undefined;
  for (const chunk of input.chunks) {
    if (input.fov > chunk.bin.maxFov) continue;
    for (let offset = 0; offset + STAR_FLOATS <= chunk.data.length; offset += STAR_FLOATS) {
      const record = chunk.data;
      const baseDirection: Vec3 = [
        record[offset + StarField.x] ?? 0,
        record[offset + StarField.y] ?? 0,
        record[offset + StarField.z] ?? 0,
      ];
      const apparent = apparentStarDirection(
        baseDirection,
        record[offset + StarField.pmRa] ?? 0,
        record[offset + StarField.pmDec] ?? 0,
        input.frame,
      );
      const worldDirection = eqjToWorld(apparent, input.frame);
      if (worldDirection[1] < -0.009) continue;
      const point = screenPoint(worldDirection, input);
      if (!point.visible) continue;
      const dx = point.x - input.x;
      const dy = point.y - input.y;
      const distanceSquared = dx * dx + dy * dy;
      const magnitude = record[offset + StarField.magnitude] ?? 0;
      const threshold = Math.min(16, Math.max(5, 12 - Math.max(-1, magnitude) * 0.6));
      if (
        distanceSquared <= threshold * threshold &&
        (!closestStar || distanceSquared < closestStar.distanceSquared)
      ) {
        closestStar = { record: recordAt(record, offset), distanceSquared };
      }
    }
  }
  if (!closestStar) return undefined;
  const hip = Math.round(closestStar.record[StarField.hip]);
  const named = input.names.get(hip);
  return named
    ? { kind: 'star', record: closestStar.record, named }
    : { kind: 'star', record: closestStar.record };
}

export function resolveSkyTarget(
  target: SkyTarget,
  frame: ObservationFrame,
  bodies: SolarBodyPosition[],
): ResolvedSkyTarget {
  if (target.kind === 'solar') {
    const body = bodies.find((candidate) => candidate.body === target.body);
    if (!body) throw new Error('Solar body is not present in the current ephemeris');
    return { kind: 'solar', body, worldDirection: body.worldDirection };
  }

  const record = target.record;
  const baseDirection: Vec3 = [record[0], record[1], record[2]];
  const apparent = apparentStarDirection(baseDirection, record[3], record[4], frame);
  const worldDirection = eqjToWorld(apparent, frame);
  const hip = Math.round(record[StarField.hip]);
  const tyc = tycDesignation(record);
  return {
    kind: 'star',
    name: target.named?.name ?? (hip > 0 ? `HIP ${hip}` : tyc),
    english: target.named?.english ?? '',
    hip,
    tyc,
    magnitude: record[StarField.magnitude],
    colorIndex: record[StarField.colorIndex],
    j2000: directionToEquatorial(baseDirection),
    apparent: apparentEquatorial(apparent, frame),
    horizontal: worldToHorizontal(worldDirection),
    worldDirection,
  };
}
