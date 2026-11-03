import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildGnisPlacesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('gnis_places')
    .addColumn('id', 'integer', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addCheckConstraint('gnis_places_id_check', sql`id > 0`)
    .addCheckConstraint('gnis_places_state_check', sql`state ~ '^[A-Z]{2}$'`);

export const createGnisPlacesTable = async (db: Kysely<Database>) => {
  await buildGnisPlacesTable(db).execute();
};
