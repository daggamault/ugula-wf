import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { trimmed } from './checks.ts';

const buildOrganizationsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('organizations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('name', 'text', (col) => col.notNull().unique())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('organizations_name_check', trimmed('name'));

const buildAgenciesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('agencies')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('organization_id', 'uuid', (col) =>
      col.notNull().references('organizations.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('sftp_username', 'text', (col) => col.unique())
    .addColumn('sftp_password_hash', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('agencies_organization_id_name_unique', ['organization_id', 'name'])
    .addUniqueConstraint('agencies_id_organization_id_unique', ['id', 'organization_id'])
    .addCheckConstraint('agencies_name_check', trimmed('name'));

export const createAgenciesTable = async (db: Kysely<Database>) => {
  await buildOrganizationsTable(db).execute();
  await buildAgenciesTable(db).execute();
};
