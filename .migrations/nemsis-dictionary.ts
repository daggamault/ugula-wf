import type { Database } from '@ugula/db';
import { PICK_LISTS } from '@ugula/nemsis';
import { type Kysely, sql } from 'kysely';
import { oneOf } from './checks.ts';

const buildNemsisElementsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('nemsis_elements')
    .addColumn('element', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addCheckConstraint('nemsis_elements_element_check', sql`element ~ '^[a-z][A-Za-z]+\.[0-9]+$'`);

const buildNemsisCodesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('nemsis_codes')
    .addColumn('list', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('nemsis_codes_pkey', ['list', 'code']);

const buildNemsisPickListsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('nemsis_pick_lists')
    .addColumn('list', 'text', (col) => col.notNull())
    .addColumn('code_set', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull().modifyFront(sql`collate "C"`))
    .addPrimaryKeyConstraint('nemsis_pick_lists_pkey', ['list', 'code_set', 'code'])
    .addForeignKeyConstraint(
      'nemsis_pick_lists_code_fkey',
      ['code_set', 'code'],
      'codes',
      ['code_set', 'code'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('nemsis_pick_lists_list_check', oneOf('list', PICK_LISTS));

export const createNemsisDictionaryTables = async (db: Kysely<Database>) => {
  await buildNemsisElementsTable(db).execute();
  await buildNemsisCodesTable(db).execute();
  await buildNemsisPickListsTable(db).execute();
};
