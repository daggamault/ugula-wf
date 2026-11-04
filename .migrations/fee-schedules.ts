import { HCPCS_PATTERN } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildFeeSchedulesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('fee_schedules')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('payer_id', 'uuid')
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'fee_schedules_payer_id_fkey',
      ['agency_id', 'payer_id'],
      'payers',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint(
      'fee_schedules_agency_payer_code_unique',
      ['agency_id', 'payer_id', 'code'],
      (c) => c.nullsNotDistinct()
    )
    .addCheckConstraint('fee_schedules_code_check', sql`code ~ ${sql.lit(HCPCS_PATTERN)}`)
    .addCheckConstraint('fee_schedules_amount_check', sql`amount_cents >= 0`);

export const createFeeSchedulesTable = async (db: Kysely<Database>) => {
  await buildFeeSchedulesTable(db).execute();
};
