import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { containsPattern } from '../../shared/search.ts';

const FACILITY_OPTIONS_LIMIT = 20;

export const listFacilityOptions = (db: Db, agencyId: string, q: string | undefined) => {
  const base = db
    .selectFrom('facilities')
    .select(['id', 'name'])
    .where('agency_id', '=', agencyId)
    .orderBy(sql`lower(name)`)
    .orderBy('id')
    .limit(FACILITY_OPTIONS_LIMIT);
  return (q ? base.where(sql`lower(name)`, 'like', containsPattern(q)) : base).execute();
};

export const findFacilityName = async (db: Db, agencyId: string, facilityId: string) =>
  (
    await db
      .selectFrom('facilities')
      .select('name')
      .where('id', '=', facilityId)
      .where('agency_id', '=', agencyId)
      .executeTakeFirst()
  )?.name;

export const assignFacility = async (
  db: Db,
  claim: { agencyId: string; claimId: string; userId: string },
  facility: { id: string; name: string } | null
) => {
  await db
    .updateTable('claims')
    .set({ facility_id: facility?.id ?? null, updated_at: sql`now()` })
    .where('id', '=', claim.claimId)
    .where('agency_id', '=', claim.agencyId)
    .execute();
  await db
    .insertInto('claim_events')
    .values({
      claim_id: claim.claimId,
      kind: 'responsibility',
      note: facility ? `Billed to ${facility.name}` : 'Billed to the payers',
      created_by: claim.userId
    })
    .execute();
};
