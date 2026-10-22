import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildUsersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

export const buildUsersTenantIndex = (db: Kysely<Database>) =>
  db.schema.createIndex('idx_users_tenant_id').on('users').column('tenant_id');

export const createUsersTable = async (db: Kysely<Database>) => {
  await buildUsersTable(db).execute();
  await buildUsersTenantIndex(db).execute();
};
