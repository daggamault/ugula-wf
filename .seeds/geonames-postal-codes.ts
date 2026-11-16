import type { ZipPlace } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import { BATCH, inBatches, tsvRows } from './tsv.ts';

export const GEONAMES_POSTAL_CODES_FILE = new URL(
  './data/geonames-postal-codes.tsv.gz',
  import.meta.url
);

export const readGeonamesPostalCodes = (gzipped: Buffer): ZipPlace[] =>
  tsvRows(gzipped).map(([postalCode = '', city = '', state = '', county, fips, lat, lng]) => ({
    postalCode,
    city,
    state,
    county: county || null,
    countyFips: fips || null,
    latitude: Number(lat),
    longitude: Number(lng)
  }));

export const replaceGeonamesPostalCodes = async (
  db: Kysely<Database>,
  places: readonly ZipPlace[]
) => {
  await db.deleteFrom('geonames_postal_codes').execute();
  await inBatches(places, BATCH, (batch) =>
    db
      .insertInto('geonames_postal_codes')
      .values(
        batch.map((p) => ({
          postal_code: p.postalCode,
          city: p.city,
          state: p.state,
          county: p.county,
          county_fips: p.countyFips,
          latitude: p.latitude,
          longitude: p.longitude
        }))
      )
      .execute()
  );
};
