import { CLEARINGHOUSE_FILE_KINDS, PAYMENT_OUTCOMES } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const list = (values: readonly string[]) => sql.join(values.map((v) => sql.lit(v)));

const buildClearinghouseFilesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('clearinghouse_files')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('file_name', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('content_hash', 'text', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('clearinghouse_files_agency_id_id_unique', ['agency_id', 'id'])
    .addUniqueConstraint('clearinghouse_files_agency_id_content_hash_unique', [
      'agency_id',
      'content_hash'
    ])
    .addCheckConstraint(
      'clearinghouse_files_kind_check',
      sql`kind in (${list(CLEARINGHOUSE_FILE_KINDS)})`
    )
    .addCheckConstraint('clearinghouse_files_file_name_check', sql`file_name <> ''`);

const buildRemittancesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('remittances')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('file_id', 'uuid', (col) => col.notNull())
    .addColumn('payer_name', 'text')
    .addColumn('payer_code', 'text')
    .addColumn('trace_number', 'text')
    .addColumn('payment_method', 'text')
    .addColumn('paid_on', 'date')
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('claim_paid_cents', 'integer', (col) => col.notNull())
    .addColumn('provider_adjustment_cents', 'integer', (col) => col.notNull())
    .addColumn('unmatched_count', 'integer', (col) => col.notNull())
    .addColumn('is_balanced', 'boolean', (col) => col.notNull())
    .addColumn('reconciled_at', 'timestamptz')
    .addColumn('reconciled_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('reconcile_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'remittances_file_id_fkey',
      ['agency_id', 'file_id'],
      'clearinghouse_files',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint('remittances_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('remittances_unmatched_check', sql`unmatched_count >= 0`)
    .addCheckConstraint(
      'remittances_reconciled_check',
      sql`reconciled_by is null or reconciled_at is not null`
    );

const buildClaimPaymentsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_payments')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('remittance_id', 'uuid', (col) => col.notNull())
    .addColumn('claim_id', 'uuid')
    .addColumn('coverage_position', 'smallint')
    .addColumn('claim_number', 'text', (col) => col.notNull())
    .addColumn('status_code', 'text', (col) => col.notNull())
    .addColumn('outcome', 'text', (col) => col.notNull())
    .addColumn('charge_cents', 'integer', (col) => col.notNull())
    .addColumn('paid_cents', 'integer', (col) => col.notNull())
    .addColumn('patient_cents', 'integer', (col) => col.notNull())
    .addColumn('payer_claim_number', 'text')
    .addColumn('adjustments', 'jsonb', (col) => col.notNull())
    .addColumn('lines', 'jsonb', (col) => col.notNull())
    .addColumn('remarks', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'claim_payments_remittance_id_fkey',
      ['agency_id', 'remittance_id'],
      'remittances',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addForeignKeyConstraint(
      'claim_payments_claim_id_fkey',
      ['agency_id', 'claim_id'],
      'claims',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('claim_payments_outcome_check', sql`outcome in (${list(PAYMENT_OUTCOMES)})`)
    .addCheckConstraint(
      'claim_payments_matched_check',
      sql`(claim_id is null) = (coverage_position is null)`
    );

const buildRemittancesIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_clearinghouse_files_agency_received')
    .on('clearinghouse_files')
    .columns(['agency_id', 'received_at desc']),
  db.schema
    .createIndex('idx_remittances_agency_created')
    .on('remittances')
    .columns(['agency_id', 'created_at desc']),
  db.schema.createIndex('idx_remittances_file_id').on('remittances').column('file_id'),
  db.schema
    .createIndex('idx_claim_payments_remittance_id')
    .on('claim_payments')
    .column('remittance_id'),
  db.schema.createIndex('idx_claim_payments_claim_id').on('claim_payments').column('claim_id')
];

export const createRemittancesTables = async (db: Kysely<Database>) => {
  await buildClearinghouseFilesTable(db).execute();
  await buildRemittancesTable(db).execute();
  await buildClaimPaymentsTable(db).execute();
  for (const index of buildRemittancesIndexes(db)) await index.execute();
};
