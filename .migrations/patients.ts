import { SEXES, US_STATE_PATTERN, ZIP_CODE_PATTERN } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildPatientsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('patients')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('number', 'integer', (col) => col.notNull().unique().generatedAlwaysAsIdentity())
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('first_name', 'text', (col) => col.notNull())
    .addColumn('last_name', 'text', (col) => col.notNull())
    .addColumn('last_name_key', 'text', (col) => col.notNull())
    .addColumn('birth_date', 'date', (col) => col.notNull())
    .addColumn('gender', 'text')
    .addColumn('address_line', 'text')
    .addColumn('city', 'text')
    .addColumn('state', 'text')
    .addColumn('postal_code', 'text')
    .addColumn('source_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('patients_agency_id_source_key_unique', ['agency_id', 'source_key'])
    .addUniqueConstraint('patients_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('patients_last_name_key_check', sql`last_name_key <> ''`)
    .addCheckConstraint(
      'patients_gender_check',
      sql`gender in (${sql.join(SEXES.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint('patients_state_check', sql`state ~ ${sql.lit(US_STATE_PATTERN)}`)
    .addCheckConstraint(
      'patients_postal_code_check',
      sql`postal_code ~ ${sql.lit(ZIP_CODE_PATTERN)}`
    );

const buildPatientsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_patients_birth_date')
    .on('patients')
    .columns(['agency_id', 'birth_date']),
  db.schema
    .createIndex('idx_patients_last_name_key')
    .on('patients')
    .columns(['agency_id', 'last_name_key']),
  db.schema
    .createIndex('idx_patients_last_name_trgm')
    .on('patients')
    .using('gin')
    .expression(sql`last_name_key gin_trgm_ops`),
  db.schema
    .createIndex('idx_patients_full_name_trgm')
    .on('patients')
    .using('gin')
    .expression(sql`(lower(last_name || ' ' || first_name)) gin_trgm_ops`),
  db.schema
    .createIndex('idx_patients_first_name')
    .on('patients')
    .expression(sql`agency_id, lower(first_name) text_pattern_ops`)
];

export const createPatientsTable = async (db: Kysely<Database>) => {
  await buildPatientsTable(db).execute();
  for (const index of buildPatientsIndexes(db)) await index.execute();
};
