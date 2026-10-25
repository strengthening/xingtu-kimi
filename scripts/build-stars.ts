import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { directionToHealpix, type Vector3Tuple } from '../src/astro/healpix.ts';
import {
  BIN_DEFINITIONS,
  HEALPIX_ORDER,
  STAR_BYTES,
  STAR_FLOATS,
  StarField,
  binForMagnitude,
  type CatalogFile,
  type CatalogManifest,
  type NameCatalog,
  type NamedStar,
  type ReferenceStarCatalog,
  type StarRecord,
} from '../src/data/catalog.ts';
import { loadSkyCultureInputs, type MergedName } from './sky-culture.ts';

const root = process.cwd();
const outputDirectory = path.join(root, 'public/data');
const CHUNK_RECORDS = 16384;
const MAS_TO_RADIANS = Math.PI / (180 * 3600 * 1000);
const DEGREES_TO_RADIANS = Math.PI / 180;

class RecordBucket {
  readonly chunks: Float32Array[] = [];
  count = 0;
  private current: Float32Array | undefined;
  private offset = 0;

  push(record: StarRecord): void {
    if (!this.current || this.offset === this.current.length) {
      this.current = new Float32Array(CHUNK_RECORDS * STAR_FLOATS);
      this.chunks.push(this.current);
      this.offset = 0;
    }
    this.current.set(record, this.offset);
    this.offset += STAR_FLOATS;
    this.count += 1;
  }

  toBuffer(): Buffer {
    const result = Buffer.allocUnsafe(this.count * STAR_BYTES);
    let remaining = this.count;
    let recordOffset = 0;
    for (const chunk of this.chunks) {
      const records = Math.min(CHUNK_RECORDS, remaining);
      const bytes = records * STAR_BYTES;
      Buffer.from(chunk.buffer, chunk.byteOffset, bytes).copy(result, recordOffset * STAR_BYTES);
      recordOffset += records;
      remaining -= records;
    }
    return result;
  }
}

interface BucketEntry {
  bucket: RecordBucket;
  binId: number;
  pixel?: number;
}

function numberField(line: string, start: number, end: number): number | undefined {
  const value = line.slice(start - 1, end).trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function propagatedDirection(
  raDegrees: number,
  decDegrees: number,
  pmRa: number,
  pmDec: number,
  epoch: number,
): Vector3Tuple {
  const ra = raDegrees * DEGREES_TO_RADIANS;
  const dec = decDegrees * DEGREES_TO_RADIANS;
  const cosDec = Math.cos(dec);
  const direction: Vector3Tuple = [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
  const years = 2000 - epoch;
  if (years === 0 || (pmRa === 0 && pmDec === 0)) return direction;

  const east: Vector3Tuple = [-Math.sin(ra), Math.cos(ra), 0];
  const north: Vector3Tuple = [
    -Math.sin(dec) * Math.cos(ra),
    -Math.sin(dec) * Math.sin(ra),
    cosDec,
  ];
  const x = direction[0] + years * (east[0] * pmRa + north[0] * pmDec);
  const y = direction[1] + years * (east[1] * pmRa + north[1] * pmDec);
  const z = direction[2] + years * (east[2] * pmRa + north[2] * pmDec);
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function createRecord(line: string, supplement: boolean): StarRecord | undefined {
  const tyc1 = numberField(line, 1, 4);
  const tyc2 = numberField(line, 6, 10);
  const tyc3 = numberField(line, 12, 12);
  let ra = numberField(line, 16, 27);
  let dec = numberField(line, 29, 40);
  let epoch = supplement ? 1991.25 : 2000;
  if (!supplement && (ra === undefined || dec === undefined)) {
    ra = numberField(line, 153, 164);
    dec = numberField(line, 166, 177);
    epoch = 1991.25;
  }
  if (
    tyc1 === undefined ||
    tyc2 === undefined ||
    tyc3 === undefined ||
    ra === undefined ||
    dec === undefined ||
    ra < 0 ||
    ra > 360 ||
    dec < -90 ||
    dec > 90
  ) {
    return undefined;
  }

  const pmRa = (numberField(line, 42, 48) ?? 0) * MAS_TO_RADIANS;
  const pmDec = (numberField(line, 50, 56) ?? 0) * MAS_TO_RADIANS;
  const bt = numberField(line, supplement ? 84 : 111, supplement ? 89 : 116);
  const vt = numberField(line, supplement ? 97 : 124, supplement ? 102 : 129);
  if (bt === undefined && vt === undefined) return undefined;
  const magnitude = bt !== undefined && vt !== undefined ? vt - 0.09 * (bt - vt) : (vt ?? bt);
  if (magnitude === undefined || !Number.isFinite(magnitude)) return undefined;
  const colorIndex = bt !== undefined && vt !== undefined ? 0.85 * (bt - vt) : 0.65;
  const hip = numberField(line, supplement ? 116 : 143, supplement ? 121 : 148) ?? 0;
  const direction = propagatedDirection(ra, dec, pmRa, pmDec, epoch);

  return [
    direction[0],
    direction[1],
    direction[2],
    pmRa,
    pmDec,
    magnitude,
    colorIndex,
    hip,
    tyc1,
    tyc2 * 4 + tyc3,
  ];
}

function isSolarName(name: MergedName | undefined): boolean {
  if (!name) return false;
  return [name.english, name.native].some((value) =>
    ['sun', 'sol', '太阳'].includes(value.trim().toLowerCase()),
  );
}

function inputFiles(): Array<{ file: string; supplement: boolean }> {
  return [
    ...Array.from({ length: 20 }, (_, index) => ({
      file: path.join(root, `data/raw/tycho2/tyc2.dat.${String(index).padStart(2, '0')}.gz`),
      supplement: false,
    })),
    { file: path.join(root, 'data/raw/tycho2/suppl_1.dat.gz'), supplement: true },
  ];
}

const cultures = await loadSkyCultureInputs(root);
await mkdir(outputDirectory, { recursive: true });
const buckets = new Map<string, BucketEntry>();
const referenceStars: Record<string, StarRecord> = {};
let totalInput = 0;
let totalStars = 0;
let invalidRecords = 0;
let filteredSolarRecords = 0;

for (const input of inputFiles()) {
  const lines = createInterface({
    input: createReadStream(input.file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    totalInput += 1;
    const record = createRecord(line, input.supplement);
    if (!record) {
      invalidRecords += 1;
      continue;
    }
    const hip = Math.round(record[StarField.hip]);
    const name = hip > 0 ? cultures.names.get(hip) : undefined;
    if (isSolarName(name)) {
      filteredSolarRecords += 1;
      continue;
    }

    const bin = binForMagnitude(record[StarField.magnitude]);
    const pixel =
      bin.scope === 'healpix'
        ? directionToHealpix(
            [record[StarField.x], record[StarField.y], record[StarField.z]],
            HEALPIX_ORDER,
          )
        : undefined;
    const key = pixel === undefined ? String(bin.id) : `${bin.id}:${pixel}`;
    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        bucket: new RecordBucket(),
        binId: bin.id,
        ...(pixel !== undefined ? { pixel } : {}),
      };
      buckets.set(key, entry);
    }
    entry.bucket.push(record);
    totalStars += 1;

    if (hip > 0 && cultures.requiredHips.has(hip)) {
      const key = String(hip);
      const previous = referenceStars[key];
      if (!previous || record[StarField.magnitude] < previous[StarField.magnitude]) {
        referenceStars[key] = record;
      }
    }
    if (totalInput % 250000 === 0) {
      console.log(
        `scanned ${totalInput.toLocaleString()} records; kept ${totalStars.toLocaleString()}`,
      );
    }
  }
  console.log(`processed ${path.basename(input.file)}`);
}

if (totalStars < 1_000_000) {
  throw new Error(`Expected more than one million stars, received ${totalStars}`);
}

const filesByBin = new Map<number, CatalogFile[]>();
const countsByBin = new Map<number, number>();
let totalBytes = 0;
const orderedBuckets = [...buckets.entries()].sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
for (const [key, entry] of orderedBuckets) {
  const filename =
    entry.pixel === undefined
      ? `stars-bin-${entry.binId}.bin`
      : `stars-bin-${entry.binId}-pix-${String(entry.pixel).padStart(6, '0')}.bin`;
  const buffer = entry.bucket.toBuffer();
  await writeFile(path.join(outputDirectory, filename), buffer);
  const file: CatalogFile = {
    path: filename,
    count: entry.bucket.count,
    bytes: buffer.byteLength,
    ...(entry.pixel !== undefined ? { pixel: entry.pixel } : {}),
  };
  const files = filesByBin.get(entry.binId) ?? [];
  files.push(file);
  filesByBin.set(entry.binId, files);
  countsByBin.set(entry.binId, (countsByBin.get(entry.binId) ?? 0) + file.count);
  totalBytes += file.bytes;
  console.log(
    `${filename}\t${file.count.toLocaleString()} stars\t${file.bytes.toLocaleString()} bytes`,
  );
  buckets.delete(key);
}

const namedStars: NamedStar[] = [];
for (const [hip, name] of cultures.names) {
  const record = referenceStars[String(hip)];
  if (!record || isSolarName(name)) continue;
  namedStars.push({
    hip,
    name: name.native || name.english,
    english: name.english,
    native: name.native,
    ...(name.pronunciation ? { pronunciation: name.pronunciation } : {}),
    record,
  });
}
namedStars.sort((a, b) => a.record[StarField.magnitude] - b.record[StarField.magnitude]);
const nameCatalog: NameCatalog = { version: 1, stars: namedStars };
const references: ReferenceStarCatalog = { version: 1, stars: referenceStars };
await Promise.all([
  writeFile(path.join(outputDirectory, 'names.json'), JSON.stringify(nameCatalog)),
  writeFile(path.join(outputDirectory, 'reference-stars.json'), JSON.stringify(references)),
]);

const manifest: CatalogManifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'Tycho-2 I/259 + supplement 1',
  recordFloats: STAR_FLOATS,
  recordBytes: STAR_BYTES,
  recordLayout: [
    'x',
    'y',
    'z',
    'pmRaRadPerYear',
    'pmDecRadPerYear',
    'approxJohnsonV',
    'approxJohnsonBV',
    'hip',
    'tyc1',
    'tyc2Times4PlusTyc3',
  ],
  healpixOrder: HEALPIX_ORDER,
  totalStars,
  totalInput,
  invalidRecords,
  filteredSolarRecords,
  bins: BIN_DEFINITIONS.map((definition) => ({
    id: definition.id,
    scope: definition.scope,
    maxFov: definition.maxFov,
    minMagnitude: Number.isFinite(definition.minMagnitude) ? definition.minMagnitude : null,
    maxMagnitude: Number.isFinite(definition.maxMagnitude) ? definition.maxMagnitude : null,
    count: countsByBin.get(definition.id) ?? 0,
    files: filesByBin.get(definition.id) ?? [],
  })),
};
await writeFile(path.join(outputDirectory, 'stars-manifest.json'), JSON.stringify(manifest));
console.log('--- Tycho-2 build summary ---');
console.log(
  JSON.stringify(
    {
      totalInput,
      totalStars,
      invalidRecords,
      filteredSolarRecords,
      namedStars: namedStars.length,
      referenceStars: Object.keys(referenceStars).length,
      files: orderedBuckets.length,
      totalBytes,
    },
    null,
    2,
  ),
);
