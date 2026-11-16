import { readFileSync } from 'node:fs';
import { type CodeSet, isCodeSet } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import { BATCH, inBatches, tsvRows } from './tsv.ts';

type Code = { set: CodeSet; code: string; description: string; billable: boolean };

export const CODE_SETS_FILE = new URL('./data/codes.tsv.gz', import.meta.url);

export const readCodeSets = (gzipped: Buffer): Code[] =>
  tsvRows(gzipped).flatMap(([set = '', code = '', description = '', billable]) =>
    isCodeSet(set) ? [{ set, code, description, billable: billable !== '0' }] : []
  );

export const replaceCodeSets = async (db: Kysely<Database>, codes: readonly Code[]) => {
  await db.deleteFrom('codes').execute();
  await inBatches(codes, BATCH, (batch) =>
    db
      .insertInto('codes')
      .values(
        batch.map((c) => ({
          code_set: c.set,
          code: c.code,
          description: c.description,
          billable: c.billable
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
