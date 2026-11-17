import { PLAN_STATUSES } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { oneOf, trimmed } from './checks.ts';

const MAX_INTERVAL_DAYS = 366;

const buildPaymentPlansTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payment_plans')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('claim_id', 'uuid', (col) => col.notNull())
    .addColumn('installment_cents', 'integer', (col) => col.notNull())
    .addColumn('interval_days', 'integer', (col) => col.notNull())
    .addColumn('first_due_on', 'date', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('missed_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'payment_plans_claim_id_fkey',
      ['agency_id', 'claim_id'],
      'claims',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('payment_plans_installment_cents_check', sql`installment_cents > 0`)
    .addCheckConstraint(
      'payment_plans_interval_days_check',
      sql`interval_days between 1 and ${sql.lit(MAX_INTERVAL_DAYS)}`
    )
    .addCheckConstraint('payment_plans_status_check', oneOf('status', PLAN_STATUSES))
    .addCheckConstraint('payment_plans_missed_count_check', sql`missed_count >= 0`);

const buildCollectionsPlacementsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('collections_placements')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('claim_id', 'uuid', (col) => col.notNull())
    .addColumn('agency_name', 'text', (col) => col.notNull())
    .addColumn('fee_pct', 'numeric(5, 2)', (col) => col.notNull())
    .addColumn('balance_cents', 'integer', (col) => col.notNull())
    .addColumn('placed_on', 'date', (col) => col.notNull())
    .addColumn('recalled_on', 'date')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'collections_placements_claim_id_fkey',
      ['agency_id', 'claim_id'],
      'claims',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('collections_placements_agency_name_check', trimmed('agency_name'))
    .addCheckConstraint(
      'collections_placements_fee_pct_check',
      sql`fee_pct >= 0 and fee_pct <= 100`
    )
    .addCheckConstraint('collections_placements_balance_cents_check', sql`balance_cents > 0`)
    .addCheckConstraint(
      'collections_placements_recalled_on_check',
      sql`recalled_on is null or recalled_on >= placed_on`
    );

const buildPatientBalanceIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('payment_plans_claim_id_unique')
    .on('payment_plans')
    .unique()
    .column('claim_id')
    .where(sql.ref('status'), '=', sql.lit('active')),
  db.schema.createIndex('idx_payment_plans_claim_id').on('payment_plans').column('claim_id'),
  db.schema
    .createIndex('idx_payment_plans_created_by_id')
    .on('payment_plans')
    .column('created_by_id'),
  db.schema
    .createIndex('collections_placements_claim_id_unique')
    .on('collections_placements')
    .unique()
    .column('claim_id')
    .where(sql.ref('recalled_on'), 'is', null),
  db.schema
    .createIndex('idx_collections_placements_claim_id')
    .on('collections_placements')
    .column('claim_id'),
  db.schema
    .createIndex('idx_collections_placements_agency_placed_on')
    .on('collections_placements')
    .columns(['agency_id', 'placed_on'])
];

export const createPatientBalanceTables = async (db: Kysely<Database>) => {
  await buildPaymentPlansTable(db).execute();
  await buildCollectionsPlacementsTable(db).execute();
  for (const index of buildPatientBalanceIndexes(db)) await index.execute();
};
