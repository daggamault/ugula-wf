import { gunzipSync } from 'node:zlib';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

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

export const truncate = (db: Kysely<Database>, tables: readonly (keyof Database)[]) =>
  sql`truncate table ${sql.join(tables.map((name) => sql.table(name)))}`.execute(db);
