import { gunzipSync } from 'node:zlib';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';

type Element = { element: string; name: string };

type Code = { list: string; code: string; description: string };

type Dictionary = { elements: Element[]; codes: Code[] };

export const ELEMENTS_FILE = new URL('./data/nemsis-elements.tsv.gz', import.meta.url);

export const CODES_FILE = new URL('./data/nemsis-codes.tsv.gz', import.meta.url);

const rowsOf = (gzipped: Buffer) =>
  gunzipSync(gzipped)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));

export const readElements = (gzipped: Buffer): Element[] =>
  rowsOf(gzipped).map(([element = '', name = '']) => ({ element, name }));

export const readCodes = (gzipped: Buffer): Code[] =>
  rowsOf(gzipped).map(([list = '', code = '', description = '']) => ({ list, code, description }));

const DICTIONARY_BATCH = 2_000;

const buildUpsertElements = (db: Kysely<Database>, elements: readonly Element[]) =>
  db
    .insertInto('nemsis_elements')
    .values(elements.map((e) => ({ element: e.element, name: e.name })))
    .onConflict((oc) =>
      oc.column('element').doUpdateSet({ name: (eb) => eb.ref('excluded.name') })
    );

const buildUpsertCodes = (db: Kysely<Database>, codes: readonly Code[]) =>
  db
    .insertInto('nemsis_codes')
    .values(codes.map((c) => ({ list: c.list, code: c.code, description: c.description })))
    .onConflict((oc) =>
      oc
        .columns(['list', 'code'])
        .doUpdateSet({ description: (eb) => eb.ref('excluded.description') })
    );

export const upsertDictionary = async (db: Kysely<Database>, { elements, codes }: Dictionary) => {
  for (let i = 0; i < elements.length; i += DICTIONARY_BATCH) {
    await buildUpsertElements(db, elements.slice(i, i + DICTIONARY_BATCH)).execute();
  }
  for (let i = 0; i < codes.length; i += DICTIONARY_BATCH) {
    await buildUpsertCodes(db, codes.slice(i, i + DICTIONARY_BATCH)).execute();
  }
};
