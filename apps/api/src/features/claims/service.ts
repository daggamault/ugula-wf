import { BILLING_EVENTS, claimCodeRefs, readAddress, readClaim } from '@ugula/billing';
import {
  cancelStaleReviews,
  checkClaim,
  claimColumns,
  type Db,
  describeCodes,
  emitAndDispatch,
  replaceClaimParts
} from '@ugula/db';
import type { RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { isForeignKeyViolation } from '../../shared/http.ts';
import { type Publish, publishAfter } from '../../shared/live.ts';
import { fail, ok } from '../../shared/result.ts';
import { type ClaimFilters, findClaim, findEditableClaim, searchClaims } from './queries.ts';
import type { ClaimEdit } from './schemas.ts';

type ClaimServiceDeps = { db: Db; boss: RunQueueClient; publish: Publish };

const notFound = fail('not_found', 'Claim not found');

type Address = { addressLine?: string | null; line?: string | null } & Record<
  'city' | 'state' | 'postalCode',
  string | null
>;

const addressIssue = (what: string, a: Address) => {
  const read = readAddress({ ...a, addressLine: a.addressLine ?? a.line });
  if (a.state && !read.state) return `${what}: ${a.state} is not a state`;
  if (a.postalCode && !read.postalCode) return `${what}: ${a.postalCode} is not a ZIP code`;
  return null;
};

const invalidAddress = (e: ClaimEdit) =>
  addressIssue('Patient address', e.patient) ??
  addressIssue('Pickup', e.pickup) ??
  addressIssue('Destination', e.destination);

type Kept = { encounterId: string; patientId: string; classification: string; reasons: string[] };

const validated = (e: ClaimEdit, kept: Kept) =>
  readClaim({
    ...kept,
    serviceDate: e.serviceDate,
    level: e.level,
    emergency: e.emergency,
    loadedMiles: e.loadedMiles,
    originCode: e.originCode,
    destinationCode: e.destinationCode,
    transportReason: e.transportReason,
    conditionCodes: e.conditionCodes,
    weightPounds: e.weightPounds,
    diagnoses: e.diagnoses,
    pickup: e.pickup,
    destination: e.destination,
    priorAuthorization: e.priorAuthorization,
    signatureOnFile: e.signatureOnFile,
    note: e.note,
    coverages: e.coverages,
    lines: e.lines.map((l) => ({ ...l, totalCents: Math.round(l.unitCents * l.units) })),
    totalCents: null
  });

export const createClaimService = ({ db, boss, publish }: ClaimServiceDeps) => ({
  search: async (agencyId: string, filters: ClaimFilters) =>
    ok(await searchClaims(db, agencyId, filters)),

  find: async (agencyId: string, id: string) => {
    const [claim, check] = await Promise.all([
      findClaim(db, agencyId, id),
      checkClaim(db, agencyId, id)
    ]);
    if (!claim) return notFound;
    return ok({
      claim,
      codes: await describeCodes(db, claimCodeRefs(claim)),
      issues: check?.issues ?? []
    });
  },

  edit: (agencyId: string, userId: string, id: string, edit: ClaimEdit) =>
    publishAfter(
      publish,
      agencyId,
      db
        .transaction()
        .execute(async (tx) => {
          const current = await findEditableClaim(tx, agencyId, id);
          if (!current) return notFound;
          if (current.status === 'submitted') {
            return fail(
              'conflict',
              'This claim was already sent to the clearinghouse, so it can no longer be edited; the payer needs a corrected claim.'
            );
          }
          if (current.revision !== edit.revision) {
            return fail(
              'conflict',
              'The claim changed since you opened it. Reload it to see the latest revision.'
            );
          }
          const address = invalidAddress(edit);
          if (address) return fail('invalid', address);
          let claim: ReturnType<typeof readClaim>;
          try {
            claim = validated(edit, {
              encounterId: current.encounter_id,
              patientId: current.patient_id,
              classification: current.classification,
              reasons: current.reasons
            });
          } catch (err) {
            return fail('invalid', err instanceof Error ? err.message : String(err));
          }
          const home = readAddress(edit.patient);
          const saved = await tx
            .updateTable('claims')
            .set({
              ...claimColumns(claim),
              patient_first_name: edit.patient.firstName,
              patient_last_name: edit.patient.lastName,
              patient_birth_date: edit.patient.birthDate,
              patient_sex: edit.patient.sex,
              patient_address_line: home.addressLine,
              patient_city: home.city,
              patient_state: home.state,
              patient_postal_code: home.postalCode,
              status: 'needs_review',
              revision: sql`revision + 1`,
              reviewed_by: null,
              reviewed_at: null,
              review_note: null,
              updated_at: sql`now()`
            })
            .where('agency_id', '=', agencyId)
            .where('id', '=', id)
            .returning(['revision'])
            .executeTakeFirstOrThrow();
          await replaceClaimParts(tx, agencyId, id, claim);
          await cancelStaleReviews(tx, boss, agencyId, current.encounter_id, null);
          await emitAndDispatch(tx, boss, {
            agencyId,
            type: BILLING_EVENTS.claimEdited,
            payload: { claimId: id, encounterId: current.encounter_id, revision: saved.revision },
            createdBy: userId
          });
          return ok({ id, revision: saved.revision });
        })
        .catch((err: unknown) => {
          if (isForeignKeyViolation(err)) {
            return fail('invalid', 'Choose payers from the payer directory of this agency');
          }
          throw err;
        }),
      ({ id: claimId }) => [{ kind: 'claim', id: claimId }]
    )
});

export type ClaimService = ReturnType<typeof createClaimService>;
