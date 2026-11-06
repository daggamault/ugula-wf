import { gunzipSync } from 'node:zlib';
import { type CodeSet, isCodeSet } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

type Code = { set: CodeSet; code: string; description: string };

export const CODE_SETS_FILE = new URL('./data/codes.tsv.gz', import.meta.url);

export const readCodeSets = (gzipped: Buffer): Code[] =>
  gunzipSync(gzipped)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [set = '', code = '', description = ''] = line.split('\t');
      return isCodeSet(set) ? [{ set, code, description }] : [];
    });

const CODE_BATCH = 5_000;

const buildUpsertCodes = (db: Kysely<Database>, codes: readonly Code[]) =>
  db
    .insertInto('codes')
    .values(codes.map((c) => ({ code_set: c.set, code: c.code, description: c.description })))
    .onConflict((oc) =>
      oc
        .columns(['code_set', 'code'])
        .doUpdateSet({ description: (eb) => eb.ref('excluded.description') })
    );

export const upsertCodeSets = async (db: Kysely<Database>, codes: readonly Code[]) => {
  for (let i = 0; i < codes.length; i += CODE_BATCH) {
    await buildUpsertCodes(db, codes.slice(i, i + CODE_BATCH)).execute();
  }
};
