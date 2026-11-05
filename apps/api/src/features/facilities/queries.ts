import { CLOSED_CLAIM_STATUSES } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { FacilityInput, FacilitySort } from './schemas.ts';

const columns = [
  'f.id',
  'f.name',
  'f.address_line',
  'f.city',
  'f.state',
  'f.postal_code',
  'f.phone',
  'f.updated_at'
] as const;

export type FacilityFilters = PageRequest<FacilitySort> & { q?: string | undefined };

const ORDER = { name: sql`lower(f.name)`, city: sql`lower(f.city)` };

const facilityRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('facilities as f')
    .select([
      ...columns,
      (eb) =>
        eb
          .selectFrom('claims as c')
          .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
          .select(sql<number>`coalesce(sum(b.balance_cents), 0)::int`.as('due'))
          .whereRef('c.facility_id', '=', 'f.id')
          .where('c.status', 'not in', CLOSED_CLAIM_STATUSES)
          .as('balance_cents')
    ])
    .where('f.agency_id', '=', agencyId);

export const searchFacilities = (db: Db, agencyId: string, f: FacilityFilters) => {
  const q = f.q
    ? facilityRows(db, agencyId).where(sql`lower(f.name)`, 'like', containsPattern(f.q))
    : facilityRows(db, agencyId);
  return paged(q, f, ORDER, sql.ref('f.id'));
};

export const findFacility = (db: Db, agencyId: string, id: string) =>
  facilityRows(db, agencyId).where('f.id', '=', id).executeTakeFirst();

const valuesOf = (f: FacilityInput) => ({
  name: f.name,
  address_line: f.addressLine,
  city: f.city,
  state: f.state,
  postal_code: f.postalCode,
  phone: f.phone
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
