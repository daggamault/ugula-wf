import { FACILITY_KINDS, US_STATE_PATTERN, ZIP_CODE_PATTERN } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { oneOf } from './checks.ts';

const buildFacilitiesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('facilities')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('address_line', 'text')
    .addColumn('city', 'text')
    .addColumn('state', 'text')
    .addColumn('postal_code', 'text')
    .addColumn('phone', 'text')
    .addColumn('kind', 'text', (col) => col.notNull().defaultTo('other'))
    .addColumn('contract', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('contract_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('facilities_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('facilities_name_check', sql`name <> ''`)
    .addCheckConstraint('facilities_kind_check', oneOf('kind', Object.keys(FACILITY_KINDS)))
    .addCheckConstraint('facilities_state_check', sql`state ~ ${sql.lit(US_STATE_PATTERN)}`)
    .addCheckConstraint(
      'facilities_postal_code_check',
      sql`postal_code ~ ${sql.lit(ZIP_CODE_PATTERN)}`
    );

const buildFacilityInvoicesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('facility_invoices')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('facility_id', 'uuid', (col) => col.notNull())
    .addColumn('period', 'date', (col) => col.notNull())
    .addColumn('sequence', 'integer', (col) => col.notNull())
    .addColumn('source_key', 'text', (col) => col.notNull())
    .addColumn('claim_count', 'integer', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('document', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'facility_invoices_facility_id_fkey',
      ['agency_id', 'facility_id'],
      'facilities',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('no action').onUpdate('cascade')
    )
    .addUniqueConstraint('facility_invoices_agency_id_id_unique', ['agency_id', 'id'])
    .addUniqueConstraint('facility_invoices_facility_period_unique', [
      'agency_id',
      'facility_id',
      'period',
      'sequence'
    ])
    .addUniqueConstraint('facility_invoices_source_key_unique', ['agency_id', 'source_key'])
    .addCheckConstraint('facility_invoices_period_check', sql`extract(day from period) = 1`)
    .addCheckConstraint('facility_invoices_sequence_check', sql`sequence >= 1`)
    .addCheckConstraint('facility_invoices_source_key_check', sql`source_key <> ''`)
    .addCheckConstraint(
      'facility_invoices_counts_check',
      sql`claim_count > 0 and total_cents >= 0`
    );

const buildFacilityInvoiceClaimsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('facility_invoice_claims')
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('invoice_id', 'uuid', (col) => col.notNull())
    .addColumn('facility_id', 'uuid', (col) => col.notNull())
    .addColumn('claim_id', 'uuid', (col) => col.notNull())
    .addPrimaryKeyConstraint('facility_invoice_claims_pkey', ['invoice_id', 'claim_id'])
    .addForeignKeyConstraint(
      'facility_invoice_claims_invoice_id_fkey',
      ['agency_id', 'invoice_id'],
      'facility_invoices',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addForeignKeyConstraint(
      'facility_invoice_claims_claim_id_fkey',
      ['agency_id', 'claim_id'],
      'claims',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint('facility_invoice_claims_claim_unique', ['facility_id', 'claim_id']);

const buildFacilityInvoiceClaimsIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('idx_facility_invoice_claims_agency_claim')
    .on('facility_invoice_claims')
    .columns(['agency_id', 'claim_id']);

const buildFacilitiesIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('facilities_agency_name_unique')
    .on('facilities')
    .unique()
    .expression(sql`agency_id, lower(name)`),
  db.schema
    .createIndex('idx_facilities_agency_address')
    .on('facilities')
    .expression(sql`agency_id, lower(address_line), left(postal_code, 5)`)
];

export const createFacilitiesTables = async (db: Kysely<Database>) => {
  await buildFacilitiesTable(db).execute();
  for (const index of buildFacilitiesIndexes(db)) await index.execute();
  await buildFacilityInvoicesTable(db).execute();
};

export const createFacilityInvoiceClaimsTable = async (db: Kysely<Database>) => {
  await buildFacilityInvoiceClaimsTable(db).execute();
  await buildFacilityInvoiceClaimsIndex(db).execute();
};
