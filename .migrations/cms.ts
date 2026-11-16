import {
  CARRIER_PATTERN,
  CCN_PATTERN,
  HCPCS_PATTERN,
  LOCALITY_PATTERN,
  RURALITIES,
  US_STATE_PATTERN
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { matches, oneOf, trimmed } from './checks.ts';

const buildZipLocalitiesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('cms_zip_localities')
    .addColumn('postal_code', 'text', (col) => col.primaryKey())
    .addColumn('carrier', 'text', (col) => col.notNull())
    .addColumn('locality', 'text', (col) => col.notNull())
    .addColumn('rurality', 'text', (col) => col.notNull())
    .addColumn('needs_plus_four', 'boolean', (col) => col.notNull())
    .addCheckConstraint('cms_zip_localities_postal_code_check', sql`postal_code ~ '^[0-9]{5}$'`)
    .addCheckConstraint('cms_zip_localities_carrier_check', matches('carrier', CARRIER_PATTERN))
    .addCheckConstraint('cms_zip_localities_locality_check', matches('locality', LOCALITY_PATTERN))
    .addCheckConstraint('cms_zip_localities_rurality_check', oneOf('rurality', RURALITIES));

const buildZip4LocalitiesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('cms_zip4_localities')
    .addColumn('postal_code', 'text', (col) =>
      col
        .notNull()
        .references('cms_zip_localities.postal_code')
        .onDelete('cascade')
        .onUpdate('cascade')
    )
    .addColumn('plus_four_from', 'text', (col) => col.notNull())
    .addColumn('plus_four_to', 'text', (col) => col.notNull())
    .addColumn('carrier', 'text', (col) => col.notNull())
    .addColumn('locality', 'text', (col) => col.notNull())
    .addColumn('rurality', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('cms_zip4_localities_pkey', ['postal_code', 'plus_four_from'])
    .addCheckConstraint(
      'cms_zip4_localities_range_check',
      sql`plus_four_from ~ '^[0-9]{4}$' and plus_four_to ~ '^[0-9]{4}$' and plus_four_from <= plus_four_to`
    )
    .addCheckConstraint('cms_zip4_localities_carrier_check', matches('carrier', CARRIER_PATTERN))
    .addCheckConstraint('cms_zip4_localities_locality_check', matches('locality', LOCALITY_PATTERN))
    .addCheckConstraint('cms_zip4_localities_rurality_check', oneOf('rurality', RURALITIES));

const buildAmbulanceFeesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('cms_ambulance_fees')
    .addColumn('year', 'integer', (col) => col.notNull())
    .addColumn('carrier', 'text', (col) => col.notNull())
    .addColumn('locality', 'text', (col) => col.notNull())
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('urban_cents', 'integer', (col) => col.notNull())
    .addColumn('rural_cents', 'integer', (col) => col.notNull())
    .addColumn('super_rural_cents', 'integer')
    .addColumn('rural_short_trip_cents', 'integer')
    .addPrimaryKeyConstraint('cms_ambulance_fees_pkey', ['year', 'carrier', 'locality', 'code'])
    .addCheckConstraint('cms_ambulance_fees_year_check', sql`year between 2000 and 2100`)
    .addCheckConstraint('cms_ambulance_fees_carrier_check', matches('carrier', CARRIER_PATTERN))
    .addCheckConstraint('cms_ambulance_fees_locality_check', matches('locality', LOCALITY_PATTERN))
    .addCheckConstraint('cms_ambulance_fees_code_check', matches('code', HCPCS_PATTERN))
    .addCheckConstraint(
      'cms_ambulance_fees_cents_check',
      sql`urban_cents >= 0 and rural_cents >= 0 and super_rural_cents >= 0 and rural_short_trip_cents >= 0`
    );

const buildHospitalsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('cms_hospitals')
    .addColumn('ccn', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('address_line', 'text', (col) => col.notNull())
    .addColumn('city', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('postal_code', 'text', (col) => col.notNull())
    .addColumn('phone', 'text')
    .addColumn('hospital_type', 'text', (col) => col.notNull())
    .addColumn('emergency_services', 'boolean', (col) => col.notNull())
    .addCheckConstraint('cms_hospitals_ccn_check', matches('ccn', CCN_PATTERN))
    .addCheckConstraint('cms_hospitals_name_check', trimmed('name'))
    .addCheckConstraint('cms_hospitals_address_line_check', trimmed('address_line'))
    .addCheckConstraint('cms_hospitals_city_check', trimmed('city'))
    .addCheckConstraint('cms_hospitals_hospital_type_check', trimmed('hospital_type'))
    .addCheckConstraint('cms_hospitals_state_check', matches('state', US_STATE_PATTERN))
    .addCheckConstraint('cms_hospitals_postal_code_check', sql`postal_code ~ '^[0-9]{5}$'`)
    .addCheckConstraint('cms_hospitals_phone_check', sql`phone ~ '^[0-9]{10}$'`);

const buildHospitalsStateIndex = (db: Kysely<Database>) =>
  db.schema.createIndex('cms_hospitals_state_idx').on('cms_hospitals').column('state');

export const createCmsTables = async (db: Kysely<Database>) => {
  await buildZipLocalitiesTable(db).execute();
  await buildZip4LocalitiesTable(db).execute();
  await buildAmbulanceFeesTable(db).execute();
  await buildHospitalsTable(db).execute();
  await buildHospitalsStateIndex(db).execute();
};
