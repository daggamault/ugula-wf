import {
  AMBULANCE_CONDITIONS,
  CLAIM_STATUSES,
  CLASSIFICATIONS,
  CONDITION_LIMIT,
  DIAGNOSIS_LIMIT,
  HCPCS_PATTERN,
  ICD10_PATTERN,
  INSURED_RELATIONSHIPS,
  MAX_LINE_MODIFIERS,
  MODIFIER_PATTERN,
  ORIGIN_DESTINATION_CODES,
  SERVICE_LEVELS,
  TRANSPORT_REASONS,
  UNIT_SCALE
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { agencySetNullForeignKey } from './foreign-keys.ts';
import { dailyNumberCheck, dailyNumberTrigger } from './numbers.ts';

const list = (values: readonly string[]) => sql.join(values.map((v) => sql.lit(v)));

const DESTINATION_CODES = Object.keys(ORIGIN_DESTINATION_CODES);

const ORIGIN_CODES = DESTINATION_CODES.filter((c) => c !== 'X');

const MODIFIERS_TEXT = `^(${MODIFIER_PATTERN.slice(1, -1)})*$`;

const buildClaimsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claims')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('number', 'text', (col) => col.notNull())
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('encounter_id', 'uuid', (col) => col.notNull())
    .addColumn('patient_id', 'uuid', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('needs_review'))
    .addColumn('revision', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('reviewed_by', 'uuid', (col) =>
      col.references('users.id').onDelete('restrict').onUpdate('cascade')
    )
    .addColumn('reviewed_at', 'timestamptz')
    .addColumn('review_note', 'text')
    .addColumn('classification', 'text', (col) => col.notNull())
    .addColumn('service_date', 'date')
    .addColumn('level', 'text', (col) => col.notNull())
    .addColumn('is_emergency', 'boolean', (col) => col.notNull())
    .addColumn('loaded_miles', 'numeric')
    .addColumn('origin_code', 'text')
    .addColumn('destination_code', 'text')
    .addColumn('transport_reason', 'text')
    .addColumn('condition_codes', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('weight_pounds', 'integer')
    .addColumn('total_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('reasons', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'claims_encounter_id_fkey',
      ['agency_id', 'encounter_id'],
      'encounters',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('no action').onUpdate('cascade')
    )
    .addForeignKeyConstraint(
      'claims_patient_id_fkey',
      ['agency_id', 'patient_id'],
      'patients',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('no action').onUpdate('cascade')
    )
    .addUniqueConstraint('claims_agency_id_id_unique', ['agency_id', 'id'])
    .addUniqueConstraint('claims_agency_id_number_unique', ['agency_id', 'number'])
    .addUniqueConstraint('claims_agency_id_encounter_id_unique', ['agency_id', 'encounter_id'])
    .addCheckConstraint('claims_number_check', dailyNumberCheck)
    .addCheckConstraint('claims_status_check', sql`status in (${list(CLAIM_STATUSES)})`)
    .addCheckConstraint('claims_revision_check', sql`revision >= 1`)
    .addCheckConstraint(
      'claims_review_check',
      sql`(status = 'needs_review') = (reviewed_by is null) and (reviewed_by is null) = (reviewed_at is null) and (status <> 'on_hold' or review_note <> '')`
    )
    .addCheckConstraint(
      'claims_classification_check',
      sql`classification in (${list(CLASSIFICATIONS)})`
    )
    .addCheckConstraint('claims_level_check', sql`level in (${list(SERVICE_LEVELS)})`)
    .addCheckConstraint('claims_loaded_miles_check', sql`loaded_miles >= 0`)
    .addCheckConstraint(
      'claims_origin_destination_check',
      sql`(origin_code is null) = (destination_code is null) and origin_code in (${list(ORIGIN_CODES)}) and destination_code in (${list(DESTINATION_CODES)})`
    )
    .addCheckConstraint(
      'claims_transport_reason_check',
      sql`transport_reason in (${list(Object.keys(TRANSPORT_REASONS))})`
    )
    .addCheckConstraint(
      'claims_condition_codes_check',
      sql`cardinality(condition_codes) <= ${sql.lit(CONDITION_LIMIT)} and condition_codes <@ array[${list(Object.keys(AMBULANCE_CONDITIONS))}]`
    )
    .addCheckConstraint('claims_weight_check', sql`weight_pounds > 0`)
    .addCheckConstraint('claims_total_check', sql`total_cents >= 0`)
    .addCheckConstraint('claims_reasons_check', sql`array_position(reasons, '') is null`);

const buildClaimLinesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('claim_lines')
    .addColumn('claim_id', 'uuid', (col) =>
      col.notNull().references('claims.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('position', 'smallint', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('modifiers', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn('units', sql`numeric(8, ${sql.lit(UNIT_SCALE)})`, (col) => col.notNull())
    .addColumn('unit_cents', 'integer', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('claim_lines_pkey', ['claim_id', 'position'])
    .addCheckConstraint('claim_lines_position_check', sql`position >= 1`)
    .addCheckConstraint('claim_lines_code_check', sql`code ~ ${sql.lit(HCPCS_PATTERN)}`)
    .addCheckConstraint(
      'claim_lines_modifiers_check',
      sql`cardinality(modifiers) <= ${sql.lit(MAX_LINE_MODIFIERS)} and array_to_string(modifiers, '') ~ ${sql.lit(MODIFIERS_TEXT)}`
    )
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
    .addColumn('member_id', 'text')
    .addColumn('group_id', 'text')
    .addColumn('relationship', 'text', (col) => col.notNull())
    .addColumn('insured_first_name', 'text')
    .addColumn('insured_last_name', 'text')
    .addForeignKeyConstraint(
      'claim_coverages_claim_id_fkey',
      ['agency_id', 'claim_id'],
      'claims',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint('claim_coverages_claim_id_position_unique', ['claim_id', 'position'])
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

const buildClaimsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_claims_agency_status')
    .on('claims')
    .columns(['agency_id', 'status', 'created_at desc']),
  db.schema
    .createIndex('idx_claims_agency_service_date')
    .on('claims')
    .columns(['agency_id', 'service_date']),
  db.schema.createIndex('idx_claims_patient_id').on('claims').column('patient_id'),
  db.schema
    .createIndex('claim_coverages_claim_payer_name_unique')
    .on('claim_coverages')
    .unique()
    .expression(sql`claim_id, lower(payer_name), lower(coalesce(member_id, ''))`),
  db.schema.createIndex('idx_claim_coverages_payer_id').on('claim_coverages').column('payer_id')
];

export const createClaimsTables = async (db: Kysely<Database>) => {
  await buildClaimsTable(db).execute();
  await dailyNumberTrigger('claims', 'claim').execute(db);
  await buildClaimLinesTable(db).execute();
  await buildClaimCoveragesTable(db).execute();
  await buildClaimCoveragesPayerForeignKey().execute(db);
  await buildClaimDiagnosesTable(db).execute();
  for (const index of buildClaimsIndexes(db)) await index.execute();
};
