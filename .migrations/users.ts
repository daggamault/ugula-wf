import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildUsersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('users_tenant_id_id_unique', ['tenant_id', 'id'])
    .addCheckConstraint('users_email_check', sql`email <> ''`);

export const buildUsersEmailIndex = (db: Kysely<Database>) =>
  db.schema.createIndex('users_email_unique').on('users').unique().expression(sql`lower(email)`);

export const createUsersTable = async (db: Kysely<Database>) => {
  await buildUsersTable(db).execute();
  await buildUsersEmailIndex(db).execute();
};
