import { CLOSED_CLAIM_STATUSES, type FacilityKind } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern, escapeLike } from '../../shared/search.ts';
import type { FacilityInput, FacilitySort } from './schemas.ts';

const columns = [
  'f.id',
  'f.name',
  'f.address_line',
  'f.city',
  'f.state',
  'f.postal_code',
  'f.phone',
  'f.kind',
  'f.has_contract',
  'f.contract_note',
  'f.updated_at'
] as const;

export type FacilityFilters = PageRequest<FacilitySort> & {
  q?: string | undefined;
  kind: readonly FacilityKind[];
};

const ORDER = { name: sql`lower(f.name)`, city: sql`lower(f.city)` };

const FACILITY_FACETS = { kind: { value: sql.ref('f.kind') } };

type FacilityFacet = keyof typeof FACILITY_FACETS;

const facilityRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('facilities as f')
    .select([
      ...columns,
      (eb) =>
        eb
          .selectFrom('claims as c')
          .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
          .select(sql<number>`coalesce(sum(b.balance_cents), 0)::float8`.as('due'))
          .whereRef('c.facility_id', '=', 'f.id')
          .where('c.status', 'not in', CLOSED_CLAIM_STATUSES)
          .as('balance_cents')
    ])
    .where('f.agency_id', '=', agencyId);

const filteredFacilities = (
  db: Db,
  agencyId: string,
  f: FacilityFilters,
  except?: FacilityFacet
) => {
  const q = f.q
    ? facilityRows(db, agencyId).where(sql`lower(f.name)`, 'like', containsPattern(f.q))
    : facilityRows(db, agencyId);
  return whereFacets(q, FACILITY_FACETS, f, except);
};

export const searchFacilities = async (db: Db, agencyId: string, f: FacilityFilters) => {
  const [page, facets] = await Promise.all([
    paged(filteredFacilities(db, agencyId, f), f, ORDER, sql.ref('f.id')),
    facetCounts((except) => filteredFacilities(db, agencyId, f, except), FACILITY_FACETS)
  ]);
  return { ...page, facets };
};

export const findFacility = (db: Db, agencyId: string, id: string) =>
  facilityRows(db, agencyId).where('f.id', '=', id).executeTakeFirst();

const valuesOf = (f: FacilityInput) => ({
  name: f.name,
  address_line: f.addressLine,
  city: f.city,
  state: f.state,
  postal_code: f.postalCode,
  phone: f.phone,
  kind: f.kind,
  has_contract: f.hasContract,
  contract_note: f.contractNote
});

export const insertFacility = (db: Db, agencyId: string, f: FacilityInput) =>
  db
    .insertInto('facilities')
    .values({ agency_id: agencyId, ...valuesOf(f) })
    .onConflict((oc) => oc.expression(sql`agency_id, lower(name)`).doNothing())
    .returning('id')
    .executeTakeFirst();

export const updateFacility = (db: Db, agencyId: string, id: string, f: FacilityInput) =>
  db
    .updateTable('facilities')
    .set({ ...valuesOf(f), updated_at: sql`now()` })
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .returning('id')
    .executeTakeFirst();

export const deleteFacility = async (db: Db, agencyId: string, id: string) =>
  (await db
    .deleteFrom('facilities')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

const HOSPITAL_LIMIT = 20;

export const searchHospitals = async (db: Db, q: string | undefined) => {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return db
    .selectFrom('cms_hospitals')
    .select([
      'ccn',
      'name',
      'address_line',
      'city',
      'state',
      'postal_code',
      'phone',
      'hospital_type'
    ])
    .where((eb) => eb.and(words.map((w) => eb('name', 'ilike', `%${escapeLike(w)}%`))))
    .orderBy(sql`similarity(${q}, name)`, 'desc')
    .orderBy('name')
    .limit(HOSPITAL_LIMIT)
    .execute();
};
