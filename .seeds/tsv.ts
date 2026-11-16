import { gunzipSync } from 'node:zlib';

export const tsvRows = (gzipped: Buffer) =>
  gunzipSync(gzipped)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));

export const inBatches = async <T>(
  rows: readonly T[],
  size: number,
  save: (batch: readonly T[]) => Promise<unknown>
) => {
  for (let i = 0; i < rows.length; i += size) await save(rows.slice(i, i + size));
};

export const BATCH = 5_000;
