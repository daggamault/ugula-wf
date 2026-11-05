import { US_STATE_PATTERN, ZIP_CODE_PATTERN } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

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
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('facilities_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('facilities_name_check', sql`name <> ''`)
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
    .addColumn('claim_count', 'integer', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('document', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addForeignKeyConstraint(
      'facility_invoices_facility_id_fkey',
      ['agency_id', 'facility_id'],
      'facilities',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addUniqueConstraint('facility_invoices_facility_period_unique', [
      'agency_id',
      'facility_id',
      'period'
    ])
    .addCheckConstraint('facility_invoices_period_check', sql`extract(day from period) = 1`)
    .addCheckConstraint(
      'facility_invoices_counts_check',
      sql`claim_count > 0 and total_cents >= 0`
    );

const buildFacilitiesIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('facilities_agency_name_unique')
    .on('facilities')
    .unique()
    .expression(sql`agency_id, lower(name)`);

export const createFacilitiesTables = async (db: Kysely<Database>) => {
  await buildFacilitiesTable(db).execute();
  await buildFacilitiesIndex(db).execute();
  await buildFacilityInvoicesTable(db).execute();
};
