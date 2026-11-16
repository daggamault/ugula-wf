import {
  HOSPITAL_NAME_SIMILARITY,
  HOSPITAL_WORD_SIMILARITY,
  pickHospital,
  type ReferenceStore
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const HOSPITAL_CANDIDATES = 5;

export const createReferenceStore = (db: Kysely<Database>): ReferenceStore => ({
  findCode: async (set, code) => {
    const row = await db
      .selectFrom('codes')
      .select(['description', 'is_billable'])
      .where('code_set', '=', set)
      .where('code', '=', code)
      .executeTakeFirst();
    return row ? { description: row.description, billable: row.is_billable } : null;
  },
  medicareLocality: async (postalCode) => {
    const plusFour = postalCode.slice(5) || null;
    const row = await db
      .selectFrom('cms_zip_localities as z')
      .leftJoin('cms_zip4_localities as p', (j) =>
        j
          .onRef('p.postal_code', '=', 'z.postal_code')
          .on((eb) =>
            eb.between(eb.val(plusFour), eb.ref('p.plus_four_from'), eb.ref('p.plus_four_to'))
          )
      )
      .select((eb) => [
        eb.fn.coalesce('p.carrier', 'z.carrier').as('carrier'),
        eb.fn.coalesce('p.locality', 'z.locality').as('locality'),
        eb.fn.coalesce('p.rurality', 'z.rurality').as('rurality'),
        'z.needs_plus_four'
      ])
      .where('z.postal_code', '=', postalCode.slice(0, 5))
      .executeTakeFirst();
    return row
      ? {
          carrier: row.carrier,
          locality: row.locality,
          rurality: row.rurality,
          plusFourNeeded: row.needs_plus_four && plusFour === null
        }
      : null;
  },
  medicareFees: async (year, carrier, locality, codes) => {
    if (!codes.length) return [];
    const rows = await db
      .selectFrom('cms_ambulance_fees')
      .select(['code', 'urban_cents', 'rural_cents', 'super_rural_cents', 'rural_short_trip_cents'])
      .where('year', '=', year)
      .where('carrier', '=', carrier)
      .where('locality', '=', locality)
      .where('code', 'in', codes)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({
      code: r.code,
      urbanCents: r.urban_cents,
      ruralCents: r.rural_cents,
      superRuralCents: r.super_rural_cents,
      ruralShortTripCents: r.rural_short_trip_cents
    }));
  },
  zipPlace: async (postalCode) => {
    const row = await db
      .selectFrom('geonames_postal_codes')
      .select(['postal_code', 'city', 'state', 'county', 'county_fips', 'latitude', 'longitude'])
      .where('postal_code', '=', postalCode)
      .executeTakeFirst();
    return row
      ? {
          postalCode: row.postal_code,
          city: row.city,
          state: row.state,
          county: row.county,
          countyFips: row.county_fips,
          latitude: row.latitude,
          longitude: row.longitude
        }
      : null;
  },
  findHospital: async (name, state, postalCode) => {
    const rows = await db
      .selectFrom('cms_hospitals')
      .select([
        'ccn',
        'name',
        'address_line',
        'city',
        'state',
        'postal_code',
        'phone',
        'hospital_type',
        'has_emergency_services',
        sql<number>`similarity(${name}, name)`.as('similarity')
      ])
      .where('state', '=', state)
      .where(sql<number>`word_similarity(${name}, name)`, '>=', HOSPITAL_WORD_SIMILARITY)
      .where(sql<number>`similarity(${name}, name)`, '>=', HOSPITAL_NAME_SIMILARITY)
      .orderBy('similarity', 'desc')
      .orderBy('ccn')
      .limit(HOSPITAL_CANDIDATES)
      .execute();
    return pickHospital(
      rows.map((r) => ({
        ccn: r.ccn,
        name: r.name,
        addressLine: r.address_line,
        city: r.city,
        state: r.state,
        postalCode: r.postal_code,
        phone: r.phone,
        hospitalType: r.hospital_type,
        emergencyServices: r.has_emergency_services,
        similarity: r.similarity
      })),
      postalCode
    );
  }
});
