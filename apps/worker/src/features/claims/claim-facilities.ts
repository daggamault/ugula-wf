import {
  type ClaimStore,
  isClosedStatus,
  isFacilityKind,
  type ResponsibleParty
} from '@ugula/billing';
import { type Db, lockClaim } from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import { agencyClaim, signalClaim } from './claim-scope.ts';

const FACILITY: ResponsibleParty = 'facility';

export const createFacilityStore = (
  db: Db,
  boss: RunQueueClient
): Pick<ClaimStore, 'setResponsibility' | 'facilityDirectory'> => ({
  setResponsibility: async (runId, claimId, sourceKey, r) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const locked = await lockClaim(tx, claim.agency_id, claim.id);
      if (!locked) throw new Error(`Claim ${claimId} does not exist`);
      const recorded = await tx
        .selectFrom('claim_events')
        .select('id')
        .where('claim_id', '=', claim.id)
        .where('source_key', '=', sourceKey)
        .executeTakeFirst();
      if (recorded) return;
      if (isClosedStatus(locked.status)) throw new Error('The claim is already closed');
      const facility = r.party === FACILITY ? r.facilityId : null;
      if (r.party === FACILITY && !(facility && isUuid(facility))) {
        throw new Error('Choose the facility the claim is billed to');
      }
      if (
        facility &&
        !(await tx
          .selectFrom('facilities')
          .select('id')
          .where('id', '=', facility)
          .where('agency_id', '=', claim.agency_id)
          .executeTakeFirst())
      ) {
        throw new Error(`Facility ${facility} is not in the facility directory`);
      }
      await tx
        .insertInto('claim_events')
        .values({
          claim_id: claim.id,
          kind: 'responsibility',
          note: r.note,
          source_key: sourceKey
        })
        .execute();
      await tx
        .updateTable('claims')
        .set({ facility_id: facility, updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .execute();
      await signalClaim(tx, boss, claim.agency_id, claim.id);
    });
  },

  facilityDirectory: async (runId) =>
    (
      await db
        .selectFrom('facilities')
        .select(['id', 'name', 'kind', 'contract'])
        .where('agency_id', '=', runAgency(db, runId))
        .orderBy('name')
        .execute()
    ).flatMap((f) => (isFacilityKind(f.kind) ? [{ ...f, kind: f.kind }] : []))
});
