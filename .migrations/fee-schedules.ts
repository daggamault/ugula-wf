import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildFeeSchedulesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('fee_schedules')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('payer', 'text')
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('fee_schedules_code_check', sql`code ~ '^[A-Z][0-9]{4}$'`)
    .addCheckConstraint('fee_schedules_payer_check', sql`payer is null or payer <> ''`)
    .addCheckConstraint('fee_schedules_amount_check', sql`amount_cents >= 0`);

export const FEE_IDENTITY = sql`tenant_id, lower(coalesce(payer, '')), code`;

export const buildFeeSchedulesIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('fee_schedules_tenant_payer_code_unique')
    .on('fee_schedules')
    .unique()
    .expression(FEE_IDENTITY);

export const createFeeSchedulesTable = async (db: Kysely<Database>) => {
  await buildFeeSchedulesTable(db).execute();
  await buildFeeSchedulesIndex(db).execute();
};
