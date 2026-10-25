import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { setTimeout as delay } from 'node:timers/promises';

interface Source {
  url: string;
  destination: string;
  resumable?: boolean;
}

const root = process.cwd();
const catalogBase = 'https://cdsarc.cds.unistra.fr/ftp/cats/I/259';
const stellariumBase = 'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures';

const sources: Source[] = [
  ...Array.from({ length: 20 }, (_, index) => {
    const suffix = String(index).padStart(2, '0');
    return {
      url: `${catalogBase}/tyc2.dat.${suffix}.gz`,
      destination: `data/raw/tycho2/tyc2.dat.${suffix}.gz`,
      resumable: true,
    };
  }),
  {
    url: `${catalogBase}/suppl_1.dat.gz`,
    destination: 'data/raw/tycho2/suppl_1.dat.gz',
    resumable: true,
  },
  { url: `${catalogBase}/ReadMe`, destination: 'data/raw/tycho2/ReadMe' },
  ...(['modern', 'chinese'] as const).flatMap((culture): Source[] => [
    {
      url: `${stellariumBase}/${culture}/index.json`,
      destination: `data/raw/skycultures/${culture}-index.json`,
    },
    {
      url: `${stellariumBase}/${culture}/description.md`,
      destination: `data/raw/skycultures/${culture}-description.md`,
    },
  ]),
];

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function remoteSize(url: string): Promise<number | undefined> {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) return undefined;
  const length = Number(response.headers.get('content-length'));
  return Number.isSafeInteger(length) && length > 0 ? length : undefined;
}

async function download(source: Source): Promise<void> {
  const destination = path.join(root, source.destination);
  const partial = `${destination}.part`;
  await mkdir(path.dirname(destination), { recursive: true });

  const expected = source.resumable ? await remoteSize(source.url) : undefined;
  const existing = await fileSize(destination);
  if (existing > 0 && (!source.resumable || expected === undefined || existing === expected)) {
    console.log(`reuse ${source.destination} (${existing.toLocaleString()} bytes)`);
    return;
  }

  let downloaded = source.resumable ? await fileSize(partial) : 0;
  if (expected !== undefined && downloaded > expected) downloaded = 0;

  const headers: Record<string, string> = { 'user-agent': 'Xingtu/0.1 catalog-builder' };
  if (downloaded > 0) headers.range = `bytes=${downloaded}-`;
  const response = await fetch(source.url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}: ${source.url}`);
  }
  if (response.status !== 206) downloaded = 0;

  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    createWriteStream(partial, { flags: downloaded > 0 ? 'a' : 'w' }),
  );
  downloaded = await fileSize(partial);
  if (expected !== undefined && downloaded !== expected) {
    throw new Error(`Incomplete download ${source.url}: ${downloaded}/${expected} bytes`);
  }
  await rename(partial, destination);
  console.log(`saved ${source.destination} (${downloaded.toLocaleString()} bytes)`);
}

async function withRetry(source: Source): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await download(source);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(attempt * 750);
    }
  }
  throw lastError;
}

let nextSource = 0;
async function worker(): Promise<void> {
  while (nextSource < sources.length) {
    const source = sources[nextSource];
    nextSource += 1;
    if (source) await withRetry(source);
  }
}

await Promise.all(Array.from({ length: 3 }, () => worker()));
console.log(`Ready: ${sources.length} source files in data/raw/`);
