import { readFileSync } from 'node:fs';
import { type CodeSet, isCodeSet } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Embedder } from '@ugula/inference';
import type { Kysely } from 'kysely';
import { BATCH, inBatches, truncate, tsvRows } from './tsv.ts';

type Embed = Embedder['embed'];

type Code = { set: CodeSet; code: string; description: string; billable: boolean };

export const CODE_SETS_FILE = new URL('./data/codes.tsv.gz', import.meta.url);

export const readCodeSets = (gzipped: Buffer): Code[] =>
  tsvRows(gzipped).map(([set, code = '', description = '', billable]) => {
    if (!isCodeSet(set)) throw new Error(`Unknown code set ${set}`);
    return { set, code, description, billable: billable !== '0' };
  });

const EMBEDDED_BATCH = 500;

const isSearchedDiagnosis = (c: Code) => c.set === 'icd10cm' && c.billable;

export const embedDiagnoses = async (codes: readonly Code[], embed: Embed) => {
  const searched = codes.filter(isSearchedDiagnosis);
  const vectors = await embed(searched.map((c) => c.description));
  return new Map(searched.map((c, i) => [c.code, vectors[i] ?? []]));
};

export const replaceCodeSets = async (
  db: Kysely<Database>,
  codes: readonly Code[],
  embeddings: ReadonlyMap<string, readonly number[]>
) => {
  await truncate(db, ['codes', 'nemsis_pick_lists']);
  const vectorOf = (c: Code) => {
    const vector = isSearchedDiagnosis(c) ? embeddings.get(c.code) : undefined;
    return vector?.length ? JSON.stringify(vector) : null;
  };
  await inBatches(codes, embeddings.size ? EMBEDDED_BATCH : BATCH, (batch) =>
    db
      .insertInto('codes')
      .values(
        batch.map((c) => ({
          code_set: c.set,
          code: c.code,
          description: c.description,
          is_billable: c.billable,
          embedding: vectorOf(c)
        }))
      )
      .execute()
  );
};

export const hcpcsDescriptions = (): Record<string, string> =>
  Object.fromEntries(
    readCodeSets(readFileSync(CODE_SETS_FILE))
      .filter((c) => c.set === 'hcpcs')
      .map((c) => [c.code, c.description])
  );
