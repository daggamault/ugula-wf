import { CLAIM_FILING_CODES } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const buildBillingProfilesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('billing_profiles')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.primaryKey().references('tenants.id').onDelete('cascade').onUpdate('cascade')
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
    .addColumn('production', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('billing_profiles_npi_check', sql`npi ~ '^[0-9]{10}$'`)
    .addCheckConstraint('billing_profiles_tax_id_check', sql`tax_id ~ '^[0-9]{9}$'`)
    .addCheckConstraint('billing_profiles_state_check', sql`state ~ '^[A-Z]{2}$'`)
    .addCheckConstraint(
      'billing_profiles_postal_code_check',
      sql`postal_code ~ '^[0-9]{5}([0-9]{4})?$'`
    )
    .addCheckConstraint('billing_profiles_phone_check', sql`phone ~ '^[0-9]{10}$'`)
    .addCheckConstraint(
      'billing_profiles_clearinghouse_check',
      sql`submitter_id ~ '^[A-Za-z0-9]{2,15}$' and receiver_id ~ '^[A-Za-z0-9]{2,15}$'`
    );

export const buildPayersTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('payers')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('payer_id', 'text', (col) => col.notNull())
    .addColumn('claim_filing', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('payers_name_check', sql`name <> ''`)
    .addCheckConstraint('payers_payer_id_check', sql`payer_id ~ '^[A-Za-z0-9]{2,80}$'`)
    .addCheckConstraint(
      'payers_claim_filing_check',
      sql`claim_filing in (${sql.join(Object.keys(CLAIM_FILING_CODES).map((c) => sql.lit(c)))})`
    );

export const buildPayersIndex = (db: Kysely<Database>) =>
  db.schema
    .createIndex('payers_tenant_name_unique')
    .on('payers')
    .unique()
    .expression(sql`tenant_id, lower(name)`);

export const createBillingProfilesTables = async (db: Kysely<Database>) => {
  await buildBillingProfilesTable(db).execute();
  await buildPayersTable(db).execute();
  await buildPayersIndex(db).execute();
};
