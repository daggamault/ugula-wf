import { MAX_CONTROL_NUMBER } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildClaimsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claims')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('patient_id', 'uuid', (col) =>
      col.notNull().references('patients.id').onDelete('restrict').onUpdate('cascade')
    )
    .addColumn('pcr_number', 'text')
    .addColumn('level', 'text', (col) => col.notNull())
    .addColumn('emergency', 'boolean', (col) => col.notNull())
    .addColumn('loaded_miles', 'numeric')
    .addColumn('lines', 'jsonb', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('payers', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('coverages', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'`))
    .addColumn('details', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
    .addColumn('cycle_run_id', 'uuid', (col) =>
      col.references('workflow_runs.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('source_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claims_tenant_id_source_key_unique', ['tenant_id', 'source_key'])
    .addCheckConstraint('claims_total_check', sql`total_cents >= 0`)
    .addCheckConstraint(
      'claims_status_check',
      sql`status in ('open', 'paid', 'written_off', 'collections')`
    );

export const buildClaimBatchesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_batches')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('control_number', 'integer', (col) => col.notNull())
    .addColumn('claim_count', 'integer', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('production', 'boolean', (col) => col.notNull())
    .addColumn('document', 'jsonb', (col) => col.notNull())
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claim_batches_tenant_id_control_number_unique', [
      'tenant_id',
      'control_number'
    ])
    .addCheckConstraint(
      'claim_batches_control_number_check',
      sql`control_number between 1 and ${sql.lit(MAX_CONTROL_NUMBER)}`
    )
    .addCheckConstraint('claim_batches_counts_check', sql`claim_count > 0 and total_cents >= 0`);

export const buildClaimEventsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('payer', 'text')
    .addColumn('paid_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('adjusted_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('note', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('document', 'jsonb')
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('source_key', 'text')
    .addColumn('batch_id', 'uuid', (col) =>
      col.references('claim_batches.id').onDelete('restrict').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claim_events_claim_id_source_key_unique', ['claim_id', 'source_key'])
    .addCheckConstraint(
      'claim_events_kind_check',
      sql`kind in ('submitted', 'resubmitted', 'resubmit_queued', 'follow_up', 'response', 'payer_skipped', 'statement', 'closed')`
    )
    .addCheckConstraint('claim_events_amounts_check', sql`paid_cents >= 0 and adjusted_cents >= 0`);

export const buildClaimsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_claims_tenant_status')
    .on('claims')
    .columns(['tenant_id', 'status', 'created_at desc']),
  db.schema.createIndex('idx_claims_patient_id').on('claims').column('patient_id'),
  db.schema.createIndex('idx_claims_cycle_run_id').on('claims').column('cycle_run_id'),
  db.schema
    .createIndex('idx_claim_events_claim_id')
    .on('claim_events')
    .columns(['claim_id', 'created_at']),
  db.schema.createIndex('idx_claim_events_created_by').on('claim_events').column('created_by'),
  db.schema.createIndex('idx_claim_events_batch_id').on('claim_events').column('batch_id'),
  db.schema
    .createIndex('idx_claim_batches_tenant_created')
    .on('claim_batches')
    .columns(['tenant_id', 'created_at desc']),
  db.schema.createIndex('idx_claim_batches_created_by').on('claim_batches').column('created_by')
];

export const createClaimsTables = async (db: Kysely<Database>) => {
  await buildClaimsTable(db).execute();
  await buildClaimBatchesTable(db).execute();
  await buildClaimEventsTable(db).execute();
  for (const index of buildClaimsIndexes(db)) await index.execute();
};
