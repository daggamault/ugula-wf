import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildAgenciesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('agencies')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('sftp_username', 'text', (col) => col.unique())
    .addColumn('sftp_password_hash', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

export const createAgenciesTable = async (db: Kysely<Database>) => {
  await buildAgenciesTable(db).execute();
};
