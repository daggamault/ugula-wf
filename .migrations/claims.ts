import {
  CLAIM_EVENT_KINDS,
  COVERAGE_EVENT_KINDS,
  DIAGNOSIS_LIMIT,
  HCPCS_PATTERN,
  ICD10_PATTERN,
  MAX_CONTROL_NUMBER,
  ORIGIN_DESTINATION_CODES,
  PATIENT_EVENT_KINDS,
  SERVICE_LEVELS
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const list = (values: readonly string[]) => sql.join(values.map((v) => sql.lit(v)));

const DESTINATION_CODES = Object.keys(ORIGIN_DESTINATION_CODES);

const ORIGIN_CODES = DESTINATION_CODES.filter((c) => c !== 'X');

const STATE = '^[A-Z]{2}$';

const POSTAL_CODE = '^[0-9]{5}([0-9]{4})?$';

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
    .addColumn('import_report_id', 'uuid', (col) =>
      col.unique().references('import_reports.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('pcr_number', 'text')
    .addColumn('level', 'text', (col) => col.notNull())
    .addColumn('emergency', 'boolean', (col) => col.notNull())
    .addColumn('loaded_miles', 'numeric')
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('service_date', 'date')
    .addColumn('origin_code', 'text')
    .addColumn('destination_code', 'text')
    .addColumn('pickup_address_line', 'text')
    .addColumn('pickup_city', 'text')
    .addColumn('pickup_state', 'text')
    .addColumn('pickup_postal_code', 'text')
    .addColumn('destination_name', 'text')
    .addColumn('destination_address_line', 'text')
    .addColumn('destination_city', 'text')
    .addColumn('destination_state', 'text')
    .addColumn('destination_postal_code', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('open'))
    .addColumn('cycle_run_id', 'uuid', (col) =>
      col.references('workflow_runs.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('source_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('claims_tenant_id_source_key_unique', ['tenant_id', 'source_key'])
    .addCheckConstraint('claims_total_check', sql`total_cents >= 0`)
    .addCheckConstraint('claims_level_check', sql`level in (${list(SERVICE_LEVELS)})`)
    .addCheckConstraint('claims_loaded_miles_check', sql`loaded_miles >= 0`)
    .addCheckConstraint(
      'claims_origin_destination_check',
      sql`(origin_code is null) = (destination_code is null) and origin_code in (${list(ORIGIN_CODES)}) and destination_code in (${list(DESTINATION_CODES)})`
    )
    .addCheckConstraint('claims_pickup_state_check', sql`pickup_state ~ ${sql.lit(STATE)}`)
    .addCheckConstraint(
      'claims_pickup_postal_code_check',
      sql`pickup_postal_code ~ ${sql.lit(POSTAL_CODE)}`
    )
    .addCheckConstraint(
      'claims_destination_state_check',
      sql`destination_state ~ ${sql.lit(STATE)}`
    )
    .addCheckConstraint(
      'claims_destination_postal_code_check',
      sql`destination_postal_code ~ ${sql.lit(POSTAL_CODE)}`
    )
    .addCheckConstraint(
      'claims_status_check',
      sql`status in ('open', 'paid', 'written_off', 'collections')`
    );

export const buildClaimLinesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_lines')
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('units', sql`numeric(8, 2)`, (col) => col.notNull())
    .addColumn('unit_cents', 'integer', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('claim_lines_pkey', ['claim_id', 'position'])
    .addCheckConstraint('claim_lines_position_check', sql`position >= 1`)
    .addCheckConstraint('claim_lines_code_check', sql`code ~ ${sql.lit(HCPCS_PATTERN)}`)
    .addCheckConstraint('claim_lines_units_check', sql`units > 0`)
    .addCheckConstraint('claim_lines_amounts_check', sql`unit_cents >= 0 and total_cents >= 0`);

export const buildClaimCoveragesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_coverages')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('payer_name', 'text', (col) => col.notNull())
    .addColumn('payer_id', 'uuid', (col) =>
      col.references('payers.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('payer_code', 'text')
    .addColumn('member_id', 'text')
    .addColumn('group_id', 'text')
    .addUniqueConstraint(
      'claim_coverages_claim_id_position_unique',
      ['claim_id', 'position'],
      (c) => c.deferrable().initiallyDeferred()
    )
    .addUniqueConstraint('claim_coverages_claim_id_id_unique', ['claim_id', 'id'])
    .addCheckConstraint('claim_coverages_position_check', sql`position >= 1`)
    .addCheckConstraint('claim_coverages_payer_name_check', sql`payer_name <> ''`);

export const buildClaimDiagnosesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_diagnoses')
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('claim_diagnoses_pkey', ['claim_id', 'position'])
    .addUniqueConstraint('claim_diagnoses_claim_id_code_unique', ['claim_id', 'code'])
    .addCheckConstraint(
      'claim_diagnoses_position_check',
      sql`position between 1 and ${sql.lit(DIAGNOSIS_LIMIT)}`
    )
    .addCheckConstraint('claim_diagnoses_code_check', sql`code ~ ${sql.lit(ICD10_PATTERN)}`);

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
    .addColumn('coverage_id', 'uuid')
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
    .addForeignKeyConstraint(
      'claim_events_coverage_fkey',
      ['claim_id', 'coverage_id'],
      'claim_coverages',
      ['claim_id', 'id'],
      (fk) => fk.onDelete('restrict').onUpdate('cascade')
    )
    .addUniqueConstraint('claim_events_claim_id_source_key_unique', ['claim_id', 'source_key'])
    .addCheckConstraint('claim_events_kind_check', sql`kind in (${list(CLAIM_EVENT_KINDS)})`)
    .addCheckConstraint(
      'claim_events_coverage_check',
      sql`(kind not in (${list(COVERAGE_EVENT_KINDS)}) or coverage_id is not null) and (kind not in (${list(PATIENT_EVENT_KINDS)}) or coverage_id is null)`
    )
    .addCheckConstraint('claim_events_amounts_check', sql`paid_cents >= 0 and adjusted_cents >= 0`);

export const buildClaimBalancesView = (db: Kysely<Database>) =>
  db.schema.createView('claim_balances').as(
    db
      .selectFrom('claims as c')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_events as e')
            .select([
              sql<number>`coalesce(sum(e.paid_cents), 0)::int`.as('paid_cents'),
              sql<number>`coalesce(sum(e.adjusted_cents), 0)::int`.as('adjusted_cents')
            ])
            .whereRef('e.claim_id', '=', 'c.id')
            .as('t'),
        (join) => join.onTrue()
      )
      .select([
        'c.id as claim_id',
        't.paid_cents',
        't.adjusted_cents',
        sql<number>`c.total_cents - t.paid_cents - t.adjusted_cents`.as('balance_cents')
      ])
  );

export const buildClaimsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_claims_tenant_status')
    .on('claims')
    .columns(['tenant_id', 'status', 'created_at desc']),
  db.schema
    .createIndex('idx_claims_tenant_service_date')
    .on('claims')
    .columns(['tenant_id', 'service_date']),
  db.schema.createIndex('idx_claims_patient_id').on('claims').column('patient_id'),
  db.schema.createIndex('idx_claims_cycle_run_id').on('claims').column('cycle_run_id'),
  db.schema
    .createIndex('claim_coverages_claim_payer_name_unique')
    .on('claim_coverages')
    .unique()
    .expression(sql`claim_id, lower(payer_name)`),
  db.schema.createIndex('idx_claim_coverages_payer_id').on('claim_coverages').column('payer_id'),
  db.schema
    .createIndex('idx_claim_events_claim_id')
    .on('claim_events')
    .columns(['claim_id', 'created_at']),
  db.schema.createIndex('idx_claim_events_coverage_id').on('claim_events').column('coverage_id'),
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
  await buildClaimLinesTable(db).execute();
  await buildClaimCoveragesTable(db).execute();
  await buildClaimDiagnosesTable(db).execute();
  await buildClaimBatchesTable(db).execute();
  await buildClaimEventsTable(db).execute();
  await buildClaimBalancesView(db).execute();
  for (const index of buildClaimsIndexes(db)) await index.execute();
};
