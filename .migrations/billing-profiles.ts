import {
  CLAIM_FILING_CODES,
  MAX_CONTROL_NUMBER,
  MAX_FILING_LIMIT_DAYS,
  US_STATE_PATTERN,
  ZIP_PLUS_4_PATTERN
} from '@ugula/billing';
import { type Database, EMBEDDING_DIMENSIONS } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildBillingProfilesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('billing_profiles')
    .addColumn('agency_id', 'uuid', (col) =>
      col.primaryKey().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('organization_name', 'text', (col) => col.notNull())
    .addColumn('npi', 'text', (col) => col.notNull())
    .addColumn('tax_id', 'text', (col) => col.notNull())
    .addColumn('address_line', 'text', (col) => col.notNull())
    .addColumn('city', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('postal_code', 'text', (col) => col.notNull())
    .addColumn('phone', 'text', (col) => col.notNull())
    .addColumn('submitter_id', 'text')
    .addColumn('receiver_id', 'text')
    .addColumn('receiver_name', 'text')
    .addColumn('time_zone', 'text', (col) => col.notNull())
    .addColumn('production', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('next_control_number', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('billing_profiles_npi_check', sql`npi ~ '^[0-9]{10}$'`)
    .addCheckConstraint('billing_profiles_tax_id_check', sql`tax_id ~ '^[0-9]{9}$'`)
    .addCheckConstraint('billing_profiles_state_check', sql`state ~ ${sql.lit(US_STATE_PATTERN)}`)
    .addCheckConstraint(
      'billing_profiles_postal_code_check',
      sql`postal_code ~ ${sql.lit(ZIP_PLUS_4_PATTERN)}`
    )
    .addCheckConstraint(
      'billing_profiles_time_zone_check',
      sql`time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'`
    )
    .addCheckConstraint('billing_profiles_phone_check', sql`phone ~ '^[0-9]{10}$'`)
    .addCheckConstraint(
      'billing_profiles_next_control_number_check',
      sql`next_control_number between 1 and ${sql.lit(MAX_CONTROL_NUMBER + 1)}`
    )
    .addCheckConstraint(
      'billing_profiles_clearinghouse_check',
      sql`submitter_id ~ '^[A-Za-z0-9]{2,15}$' and receiver_id ~ '^[A-Za-z0-9]{2,15}$'`
    );

const buildPayersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payers')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('payer_id', 'text', (col) => col.notNull())
    .addColumn('claim_filing', 'text', (col) => col.notNull())
    .addColumn('filing_limit_days', 'integer')
    .addColumn('embedding', sql`vector(${sql.lit(EMBEDDING_DIMENSIONS)})`)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('payers_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('payers_name_check', sql`name <> ''`)
    .addCheckConstraint(
      'payers_filing_limit_days_check',
      sql`filing_limit_days between 1 and ${sql.lit(MAX_FILING_LIMIT_DAYS)}`
    )
    .addCheckConstraint('payers_payer_id_check', sql`payer_id ~ '^[A-Za-z0-9]{2,80}$'`)
    .addCheckConstraint(
      'payers_claim_filing_check',
      sql`claim_filing in (${sql.join(Object.keys(CLAIM_FILING_CODES).map((c) => sql.lit(c)))})`
    );

const buildPayersIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('payers_agency_name_unique')
    .on('payers')
    .unique()
    .expression(sql`agency_id, lower(name)`);

const buildPayerAliasesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payer_aliases')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('payer_id', 'uuid', (col) => col.notNull())
    .addColumn('alias', 'text', (col) => col.notNull())
    .addColumn('alias_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'payer_aliases_payer_id_fkey',
      ['agency_id', 'payer_id'],
      'payers',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint('payer_aliases_agency_id_alias_key_unique', ['agency_id', 'alias_key'])
    .addCheckConstraint('payer_aliases_alias_key_check', sql`alias_key <> ''`);

const buildPayerAliasesIndex = (db: Kysely<Database>) =>
  db.schema.createIndex('idx_payer_aliases_payer_id').on('payer_aliases').column('payer_id');

const buildPayerSuggestionsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payer_suggestions')
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('name_key', 'text', (col) => col.notNull())
    .addColumn('directory_version', 'text', (col) => col.notNull())
    .addColumn('payer_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('payer_suggestions_pkey', [
      'agency_id',
      'name_key',
      'directory_version'
    ])
    .addForeignKeyConstraint(
      'payer_suggestions_payer_id_fkey',
      ['agency_id', 'payer_id'],
      'payers',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addCheckConstraint('payer_suggestions_name_key_check', sql`name_key <> ''`);

export const createBillingProfilesTables = async (db: Kysely<Database>) => {
  await buildBillingProfilesTable(db).execute();
  await buildPayersTable(db).execute();
  await buildPayersIndex(db).execute();
  await buildPayerAliasesTable(db).execute();
  await buildPayerAliasesIndex(db).execute();
  await buildPayerSuggestionsTable(db).execute();
};
