import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildNemsisElementsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('nemsis_elements')
    .addColumn('element', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('definition', 'text', (col) => col.notNull())
    .addColumn('usage', 'text', (col) => col.notNull())
    .addCheckConstraint('nemsis_elements_element_check', sql`element ~ '^[a-z][A-Za-z]+\.[0-9]+$'`);

/**
 * Code lists keyed by element number (eResponse.05) or, for attribute values every element
 * shares, by attribute name (@NV, @PN).
 */
export const buildNemsisCodesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('nemsis_codes')
    .addColumn('list', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('nemsis_codes_pkey', ['list', 'code']);

export const createNemsisDictionaryTables = async (db: Kysely<Database>) => {
  await buildNemsisElementsTable(db).execute();
  await buildNemsisCodesTable(db).execute();
};
