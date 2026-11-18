import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { dailyNumberCheck, dailyNumberTrigger } from './numbers.ts';

const buildEncountersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('encounters')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('number', 'text', (col) => col.notNull())
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('pcr_number', 'text', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('data', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('encounters_agency_id_id_unique', ['agency_id', 'id'])
    .addUniqueConstraint('encounters_agency_id_number_unique', ['agency_id', 'number'])
    .addUniqueConstraint('encounters_agency_id_pcr_number_unique', ['agency_id', 'pcr_number'])
    .addCheckConstraint('encounters_number_check', dailyNumberCheck)
    .addCheckConstraint('encounters_pcr_number_check', sql`pcr_number <> ''`)
    .addCheckConstraint('encounters_revision_check', sql`revision >= 1`)
    .addCheckConstraint('encounters_data_check', sql`jsonb_typeof(data) = 'object'`);

export const createEncountersTable = async (db: Kysely<Database>) => {
  await buildEncountersTable(db).execute();
  await dailyNumberTrigger('encounters', 'encounter').execute(db);
};
