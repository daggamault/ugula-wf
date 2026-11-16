import { US_STATE_PATTERN } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { matches, trimmed } from './checks.ts';

const buildGeonamesPostalCodesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('geonames_postal_codes')
    .addColumn('postal_code', 'text', (col) => col.primaryKey())
    .addColumn('city', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('county', 'text')
    .addColumn('county_fips', 'text')
    .addColumn('latitude', 'real', (col) => col.notNull())
    .addColumn('longitude', 'real', (col) => col.notNull())
    .addCheckConstraint('geonames_postal_codes_postal_code_check', sql`postal_code ~ '^[0-9]{5}$'`)
    .addCheckConstraint('geonames_postal_codes_city_check', trimmed('city'))
    .addCheckConstraint('geonames_postal_codes_state_check', matches('state', US_STATE_PATTERN))
    .addCheckConstraint('geonames_postal_codes_county_check', trimmed('county'))
    .addCheckConstraint('geonames_postal_codes_county_fips_check', sql`county_fips ~ '^[0-9]{5}$'`)
    .addCheckConstraint(
      'geonames_postal_codes_coordinates_check',
      sql`latitude between -90 and 90 and longitude between -180 and 180`
    );

export const createGeonamesPostalCodesTable = async (db: Kysely<Database>) => {
  await buildGeonamesPostalCodesTable(db).execute();
};
