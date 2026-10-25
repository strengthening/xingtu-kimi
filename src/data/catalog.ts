export const STAR_FLOATS = 10;
export const STAR_BYTES = STAR_FLOATS * Float32Array.BYTES_PER_ELEMENT;
export const HEALPIX_ORDER = 3;

export const StarField = {
  x: 0,
  y: 1,
  z: 2,
  pmRa: 3,
  pmDec: 4,
  magnitude: 5,
  colorIndex: 6,
  hip: 7,
  tyc1: 8,
  tyc2Packed: 9,
} as const;

export type StarRecord = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface BinDefinition {
  id: number;
  minMagnitude: number;
  maxMagnitude: number;
  scope: 'global' | 'healpix';
  maxFov: number;
}

export const BIN_DEFINITIONS: readonly BinDefinition[] = [
  { id: 0, minMagnitude: -Infinity, maxMagnitude: 6, scope: 'global', maxFov: 180 },
  { id: 1, minMagnitude: 6, maxMagnitude: 8, scope: 'global', maxFov: 120 },
  { id: 2, minMagnitude: 8, maxMagnitude: 10, scope: 'global', maxFov: 70 },
  { id: 3, minMagnitude: 10, maxMagnitude: 11, scope: 'healpix', maxFov: 25 },
  { id: 4, minMagnitude: 11, maxMagnitude: 12, scope: 'healpix', maxFov: 12 },
  { id: 5, minMagnitude: 12, maxMagnitude: Infinity, scope: 'healpix', maxFov: 6 },
];

export interface CatalogFile {
  path: string;
  count: number;
  bytes: number;
  pixel?: number;
}

export interface CatalogBin extends Omit<BinDefinition, 'minMagnitude' | 'maxMagnitude'> {
  minMagnitude: number | null;
  maxMagnitude: number | null;
  count: number;
  files: CatalogFile[];
}

export interface CatalogManifest {
  version: 1;
  generatedAt: string;
  source: 'Tycho-2 I/259 + supplement 1';
  recordFloats: number;
  recordBytes: number;
  recordLayout: string[];
  healpixOrder: number;
  totalStars: number;
  totalInput: number;
  invalidRecords: number;
  filteredSolarRecords: number;
  bins: CatalogBin[];
}

export interface NamedStar {
  hip: number;
  name: string;
  english: string;
  native: string;
  pronunciation?: string;
  record: StarRecord;
}

export interface NameCatalog {
  version: 1;
  stars: NamedStar[];
}

export interface ReferenceStarCatalog {
  version: 1;
  stars: Record<string, StarRecord>;
}

export interface ConstellationFigure {
  id: string;
  english: string;
  native: string;
  pronunciation?: string;
  segments: Array<[number, number]>;
  labelHip: number;
}

export interface ConstellationCatalog {
  version: 1;
  stars: Record<string, StarRecord>;
  cultures: {
    modern: ConstellationFigure[];
    chinese: ConstellationFigure[];
  };
  lunarMansions: Array<{
    hip: number;
    english: string;
    native: string;
    pronunciation?: string;
    symbol?: string;
  }>;
}

export function binForMagnitude(magnitude: number): BinDefinition {
  const bin = BIN_DEFINITIONS.find(
    (candidate) => magnitude >= candidate.minMagnitude && magnitude < candidate.maxMagnitude,
  );
  if (!bin) throw new RangeError(`Invalid stellar magnitude: ${magnitude}`);
  return bin;
}

export function tycDesignation(record: Float32Array | StarRecord, offset = 0): string {
  const tyc1 = Math.round(record[offset + StarField.tyc1] ?? 0);
  const packed = Math.round(record[offset + StarField.tyc2Packed] ?? 0);
  return `TYC ${tyc1}-${Math.floor(packed / 4)}-${packed % 4}`;
}
