import { type CodeSet, isCodeSet } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { isPickList, type PickList } from '@ugula/nemsis';
import type { Kysely } from 'kysely';
import { BATCH, inBatches, truncate, tsvRows } from './tsv.ts';

type Element = { element: string; name: string };

type Code = { list: string; code: string; description: string };

type Pick = { list: PickList; set: CodeSet; code: string };

type Dictionary = { elements: Element[]; codes: Code[]; picks: Pick[] };

export const ELEMENTS_FILE = new URL('./data/nemsis-elements.tsv.gz', import.meta.url);

export const CODES_FILE = new URL('./data/nemsis-codes.tsv.gz', import.meta.url);

export const PICK_LISTS_FILE = new URL('./data/nemsis-pick-lists.tsv.gz', import.meta.url);

export const readElements = (gzipped: Buffer): Element[] =>
  tsvRows(gzipped).map(([element = '', name = '']) => ({ element, name }));

export const readCodes = (gzipped: Buffer): Code[] =>
  tsvRows(gzipped).map(([list = '', code = '', description = '']) => ({ list, code, description }));

export const readPickLists = (gzipped: Buffer): Pick[] =>
  tsvRows(gzipped).map(([list, set, code = '']) => {
    if (!isPickList(list) || !isCodeSet(set)) {
      throw new Error(`Unknown pick list row ${list} ${set}`);
    }
    return { list, set, code };
  });

export const replaceDictionary = async (
  db: Kysely<Database>,
  { elements, codes, picks }: Dictionary
) => {
  await truncate(db, ['nemsis_pick_lists', 'nemsis_codes', 'nemsis_elements']);
  await inBatches(elements, BATCH, (batch) =>
    db
      .insertInto('nemsis_elements')
      .values(batch.map((e) => ({ element: e.element, name: e.name })))
      .execute()
  );
  await inBatches(codes, BATCH, (batch) =>
    db
      .insertInto('nemsis_codes')
      .values(batch.map((c) => ({ list: c.list, code: c.code, description: c.description })))
      .execute()
  );
  await inBatches(picks, BATCH, (batch) =>
    db
      .insertInto('nemsis_pick_lists')
      .values(batch.map((p) => ({ list: p.list, code_set: p.set, code: p.code })))
      .execute()
  );
};
