import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_REASON_PATTERN,
  AMBULANCE_CONDITIONS,
  CLAIM_EVENT_KINDS,
  CLAIM_STATUSES,
  type ClaimEventKind,
  type ClaimStatus,
  CONDITION_LIMIT,
  COVERAGE_EVENT_KINDS,
  DENIAL_ROUTES,
  DIAGNOSIS_LIMIT,
  ELIGIBILITY_STATUSES,
  HCPCS_PATTERN,
  ICD10_PATTERN,
  INSURED_RELATIONSHIPS,
  MAX_CONTROL_NUMBER,
  ORIGIN_DESTINATION_CODES,
  PATIENT_EVENT_KINDS,
  SERVICE_LEVELS,
  SIGNATURE_STATUSES,
  TRANSPORT_REASONS,
  TRIP_TYPES,
  UNIT_SCALE,
  US_STATE_PATTERN,
  ZIP_CODE_PATTERN
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { agencySetNullForeignKey } from './foreign-keys.ts';

const list = (values: readonly string[]) => sql.join(values.map((v) => sql.lit(v)));

const DESTINATION_CODES = Object.keys(ORIGIN_DESTINATION_CODES);

const ORIGIN_CODES = DESTINATION_CODES.filter((c) => c !== 'X');

const UNSENT = list(['draft', 'void'] satisfies ClaimStatus[]);

const RESPONSE = sql.lit('response' satisfies ClaimEventKind);

const REFUNDED = sql.lit('refunded' satisfies ClaimEventKind);

const PROTECTED = sql.lit('balance_protected' satisfies ClaimEventKind);

const DENIED = sql.lit('denied' satisfies ClaimEventKind);

const buildClaimsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claims')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('number', 'integer', (col) => col.notNull().unique().generatedAlwaysAsIdentity())
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('patient_id', 'uuid')
    .addColumn('import_report_id', 'uuid', (col) =>
      col.unique().references('import_reports.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('pcr_number', 'text')
    .addColumn('trip_type', 'text')
    .addColumn('level', 'text')
    .addColumn('emergency', 'boolean')
    .addColumn('loaded_miles', 'numeric')
    .addColumn('total_cents', 'integer', (col) => col.notNull().defaultTo(0))
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
    .addColumn('signature', 'text', (col) => col.notNull().defaultTo('missing'))
    .addColumn('signature_note', 'text')
    .addColumn('pcs_on_file', 'boolean')
    .addColumn('pcs_signed_on', 'date')
    .addColumn('transport_reason', 'text')
    .addColumn('condition_codes', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('prior_authorization', 'text')
    .addColumn('weight_kg', 'numeric')
    .addColumn('at_scene_at', 'timestamptz')
    .addColumn('left_scene_at', 'timestamptz')
    .addColumn('at_destination_at', 'timestamptz')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('draft'))
    .addColumn('cycle_run_id', 'uuid')
    .addColumn('facility_id', 'uuid')
    .addColumn('source_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'claims_patient_id_fkey',
      ['agency_id', 'patient_id'],
      'patients',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('no action').onUpdate('cascade')
    )
    .addUniqueConstraint('claims_agency_id_source_key_unique', ['agency_id', 'source_key'])
    .addUniqueConstraint('claims_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('claims_total_check', sql`total_cents >= 0`)
    .addCheckConstraint('claims_level_check', sql`level in (${list(SERVICE_LEVELS)})`)
    .addCheckConstraint('claims_loaded_miles_check', sql`loaded_miles >= 0`)
    .addCheckConstraint(
      'claims_origin_destination_check',
      sql`(origin_code is null) = (destination_code is null) and origin_code in (${list(ORIGIN_CODES)}) and destination_code in (${list(DESTINATION_CODES)})`
    )
    .addCheckConstraint(
      'claims_pickup_state_check',
      sql`pickup_state ~ ${sql.lit(US_STATE_PATTERN)}`
    )
    .addCheckConstraint(
      'claims_pickup_postal_code_check',
      sql`pickup_postal_code ~ ${sql.lit(ZIP_CODE_PATTERN)}`
    )
    .addCheckConstraint(
      'claims_destination_state_check',
      sql`destination_state ~ ${sql.lit(US_STATE_PATTERN)}`
    )
    .addCheckConstraint(
      'claims_destination_postal_code_check',
      sql`destination_postal_code ~ ${sql.lit(ZIP_CODE_PATTERN)}`
    )
    .addCheckConstraint('claims_signature_check', sql`signature in (${list(SIGNATURE_STATUSES)})`)
    .addCheckConstraint(
      'claims_transport_reason_check',
      sql`transport_reason in (${list(Object.keys(TRANSPORT_REASONS))})`
    )
    .addCheckConstraint(
      'claims_condition_codes_check',
      sql`condition_codes <@ array[${list(Object.keys(AMBULANCE_CONDITIONS))}]::text[] and cardinality(condition_codes) <= ${sql.lit(CONDITION_LIMIT)}`
    )
    .addCheckConstraint('claims_weight_check', sql`weight_kg > 0`)
    .addCheckConstraint('claims_status_check', sql`status in (${list(CLAIM_STATUSES)})`)
    .addCheckConstraint('claims_trip_type_check', sql`trip_type in (${list(TRIP_TYPES)})`)
    .addCheckConstraint(
      'claims_patient_check',
      sql`status in (${UNSENT}) or patient_id is not null`
    )
    .addCheckConstraint(
      'claims_service_check',
      sql`status in (${UNSENT}) or (level is not null and emergency is not null and service_date is not null)`
    );

const buildClaimsCycleRunForeignKey = () =>
  agencySetNullForeignKey({ table: 'claims', column: 'cycle_run_id', references: 'workflow_runs' });

const buildClaimsFacilityForeignKey = () =>
  agencySetNullForeignKey({ table: 'claims', column: 'facility_id', references: 'facilities' });

const buildClaimRunsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_runs')
    .addColumn('run_id', 'uuid', (col) =>
      col.primaryKey().references('workflow_runs.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    );

const buildClaimLinesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_lines')
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('units', sql`numeric(8, ${sql.lit(UNIT_SCALE)})`, (col) => col.notNull())
    .addColumn('unit_cents', 'integer', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('claim_lines_pkey', ['claim_id', 'position'])
    .addCheckConstraint('claim_lines_position_check', sql`position >= 1`)
    .addCheckConstraint('claim_lines_code_check', sql`code ~ ${sql.lit(HCPCS_PATTERN)}`)
    .addCheckConstraint('claim_lines_units_check', sql`units > 0`)
    .addCheckConstraint('claim_lines_amounts_check', sql`unit_cents >= 0 and total_cents >= 0`);

const buildClaimCoveragesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_coverages')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('claim_id', 'uuid', (col) => col.notNull())
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('payer_name', 'text', (col) => col.notNull())
    .addColumn('payer_id', 'uuid')
    .addColumn('payer_code', 'text')
    .addColumn('member_id', 'text')
    .addColumn('group_id', 'text')
    .addColumn('relationship', 'text', (col) => col.notNull())
    .addColumn('insured_first_name', 'text')
    .addColumn('insured_last_name', 'text')
    .addColumn('eligibility', 'text')
    .addColumn('eligibility_note', 'text')
    .addColumn('eligibility_checked_at', 'timestamptz')
    .addCheckConstraint(
      'claim_coverages_eligibility_check',
      sql`eligibility is null or (eligibility in (${list(ELIGIBILITY_STATUSES)}) and eligibility_checked_at is not null)`
    )
    .addForeignKeyConstraint(
      'claim_coverages_claim_id_fkey',
      ['agency_id', 'claim_id'],
      'claims',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint(
      'claim_coverages_claim_id_position_unique',
      ['claim_id', 'position'],
      (c) => c.deferrable().initiallyDeferred()
    )
    .addUniqueConstraint('claim_coverages_claim_id_id_unique', ['claim_id', 'id'])
    .addCheckConstraint('claim_coverages_position_check', sql`position >= 1`)
    .addCheckConstraint('claim_coverages_payer_name_check', sql`payer_name <> ''`)
    .addCheckConstraint(
      'claim_coverages_relationship_check',
      sql`relationship in (${list(INSURED_RELATIONSHIPS)})`
    );

const buildClaimCoveragesPayerForeignKey = () =>
  agencySetNullForeignKey({ table: 'claim_coverages', column: 'payer_id', references: 'payers' });

const buildClaimDiagnosesTable = (db: Kysely<Database>) =>
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

const buildClaimBatchesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_batches')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
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
    .addColumn('sent_at', 'timestamptz')
    .addColumn('sent_as', 'text')
    .addColumn('rejected_at', 'timestamptz')
    .addColumn('rejection', 'text')
    .addCheckConstraint('claim_batches_sent_check', sql`(sent_at is null) = (sent_as is null)`)
    .addCheckConstraint(
      'claim_batches_rejected_check',
      sql`(rejected_at is null) = (rejection is null)`
    )
    .addUniqueConstraint('claim_batches_agency_id_control_number_unique', [
      'agency_id',
      'control_number'
    ])
    .addCheckConstraint(
      'claim_batches_control_number_check',
      sql`control_number between 1 and ${sql.lit(MAX_CONTROL_NUMBER)}`
    )
    .addCheckConstraint('claim_batches_counts_check', sql`claim_count > 0 and total_cents >= 0`);

const buildClaimEventsTable = (db: Kysely<Database>) =>
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
    .addColumn('payer_claim_number', 'text')
    .addColumn('paid_on', 'date')
    .addColumn('check_number', 'text')
    .addColumn('note', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('route', 'text')
    .addColumn('document', 'jsonb')
    .addColumn('created_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('source_key', 'text')
    .addColumn('batch_id', 'uuid', (col) =>
      col.references('claim_batches.id').onDelete('no action').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'claim_events_coverage_fkey',
      ['claim_id', 'coverage_id'],
      'claim_coverages',
      ['claim_id', 'id'],
      (fk) => fk.onDelete('no action').onUpdate('cascade')
    )
    .addUniqueConstraint('claim_events_claim_id_source_key_unique', ['claim_id', 'source_key'])
    .addCheckConstraint('claim_events_kind_check', sql`kind in (${list(CLAIM_EVENT_KINDS)})`)
    .addCheckConstraint(
      'claim_events_coverage_check',
      sql`(kind not in (${list(COVERAGE_EVENT_KINDS)}) or coverage_id is not null) and (kind not in (${list(PATIENT_EVENT_KINDS)}) or coverage_id is null)`
    )
    .addCheckConstraint(
      'claim_events_amounts_check',
      sql`(kind = ${RESPONSE} and paid_cents >= 0 and adjusted_cents >= 0) or (kind = ${REFUNDED} and paid_cents < 0 and adjusted_cents = 0) or (kind = ${PROTECTED} and paid_cents = 0 and adjusted_cents > 0) or (paid_cents = 0 and adjusted_cents = 0)`
    )
    .addCheckConstraint(
      'claim_events_payment_check',
      sql`kind in (${RESPONSE}, ${REFUNDED}) or (paid_on is null and check_number is null)`
    )
    .addCheckConstraint(
      'claim_events_route_check',
      sql`(kind = ${DENIED}) = (route is not null) and route in (${list(DENIAL_ROUTES)})`
    )
    .addCheckConstraint(
      'claim_events_check_number_check',
      sql`check_number is null or check_number <> ''`
    )
    .addCheckConstraint(
      'claim_events_payer_claim_number_check',
      sql`payer_claim_number is null or (payer_claim_number <> '' and coverage_id is not null)`
    );

const buildClaimEventAdjustmentsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_event_adjustments')
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('claim_events.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('group_code', 'text', (col) => col.notNull())
    .addColumn('reason_code', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('claim_event_adjustments_pkey', ['event_id', 'position'])
    .addCheckConstraint('claim_event_adjustments_position_check', sql`position >= 1`)
    .addCheckConstraint(
      'claim_event_adjustments_group_check',
      sql`group_code in (${list(Object.keys(ADJUSTMENT_GROUPS))})`
    )
    .addCheckConstraint(
      'claim_event_adjustments_reason_check',
      sql`reason_code ~ ${sql.lit(ADJUSTMENT_REASON_PATTERN)}`
    )
    .addCheckConstraint('claim_event_adjustments_amount_check', sql`amount_cents <> 0`);

const buildClaimBalancesView = (db: Kysely<Database>) =>
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

const buildClaimsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_claims_agency_status')
    .on('claims')
    .columns(['agency_id', 'status', 'created_at desc']),
  db.schema
    .createIndex('idx_claims_agency_service_date')
    .on('claims')
    .columns(['agency_id', 'service_date']),
  db.schema
    .createIndex('claims_agency_pcr_number_unique')
    .on('claims')
    .unique()
    .columns(['agency_id', 'pcr_number'])
    .where('pcr_number', 'is not', null),
  db.schema
    .createIndex('idx_claims_pcr_number_trgm')
    .on('claims')
    .using('gin')
    .expression(sql`(lower(coalesce(pcr_number, ''))) gin_trgm_ops`),
  db.schema.createIndex('idx_claims_patient_id').on('claims').column('patient_id'),
  db.schema.createIndex('idx_claims_cycle_run_id').on('claims').column('cycle_run_id'),
  db.schema.createIndex('idx_claims_facility_id').on('claims').column('facility_id'),
  db.schema.createIndex('idx_claim_runs_claim_id').on('claim_runs').column('claim_id'),
  db.schema
    .createIndex('claim_coverages_claim_payer_name_unique')
    .on('claim_coverages')
    .unique()
    .expression(sql`claim_id, lower(payer_name), lower(coalesce(member_id, ''))`),
  db.schema.createIndex('idx_claim_coverages_payer_id').on('claim_coverages').column('payer_id'),
  db.schema
    .createIndex('idx_claim_events_claim_id')
    .on('claim_events')
    .columns(['claim_id', 'created_at']),
  db.schema.createIndex('idx_claim_events_coverage_id').on('claim_events').column('coverage_id'),
  db.schema.createIndex('idx_claim_events_created_by').on('claim_events').column('created_by'),
  db.schema.createIndex('idx_claim_events_batch_id').on('claim_events').column('batch_id'),
  db.schema
    .createIndex('idx_claim_events_kind_created')
    .on('claim_events')
    .columns(['kind', 'created_at']),
  db.schema
    .createIndex('idx_claim_batches_agency_created')
    .on('claim_batches')
    .columns(['agency_id', 'created_at desc']),
  db.schema.createIndex('idx_claim_batches_created_by').on('claim_batches').column('created_by')
];

export const createClaimsTables = async (db: Kysely<Database>) => {
  await buildClaimsTable(db).execute();
  await buildClaimsCycleRunForeignKey().execute(db);
  await buildClaimsFacilityForeignKey().execute(db);
  await buildClaimRunsTable(db).execute();
  await buildClaimLinesTable(db).execute();
  await buildClaimCoveragesTable(db).execute();
  await buildClaimCoveragesPayerForeignKey().execute(db);
  await buildClaimDiagnosesTable(db).execute();
  await buildClaimBatchesTable(db).execute();
  await buildClaimEventsTable(db).execute();
  await buildClaimEventAdjustmentsTable(db).execute();

  await buildClaimBalancesView(db).execute();
  for (const index of buildClaimsIndexes(db)) await index.execute();
};
