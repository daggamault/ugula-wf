import type { ClaimInput, ClaimStore } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

const claimColumns = (c: ClaimInput) => ({
  patient_id: c.patientId,
  classification: c.classification,
  service_date: c.serviceDate,
  level: c.level,
  is_emergency: c.emergency,
  loaded_miles: c.loadedMiles,
  origin_code: c.originCode,
  destination_code: c.destinationCode,
  total_cents: c.totalCents,
  reasons: c.reasons
});

export const createClaimStore = (db: Kysely<Database>): ClaimStore => ({
  saveClaim: (runId, claim) =>
    db.transaction().execute(async (tx) => {
      if (!isUuid(claim.encounterId))
        throw new Error(`Encounter ${claim.encounterId} does not exist`);
      if (!isUuid(claim.patientId)) throw new Error(`Patient ${claim.patientId} does not exist`);
      const unknown = claim.coverages.find((c) => c.payerId !== null && !isUuid(c.payerId));
      if (unknown) throw new Error(`Payer ${unknown.payerId} does not exist`);
      const saved = await tx
        .insertInto('claims')
        .values({
          agency_id: runAgency(tx, runId),
          encounter_id: claim.encounterId,
          ...claimColumns(claim)
        })
        .onConflict((oc) =>
          oc
            .columns(['agency_id', 'encounter_id'])
            .doUpdateSet({ ...claimColumns(claim), updated_at: sql`now()` })
        )
        .returning(['id', 'agency_id', sql<boolean>`xmax = 0`.as('inserted')])
        .executeTakeFirstOrThrow();
      await tx.deleteFrom('claim_lines').where('claim_id', '=', saved.id).execute();
      await tx.deleteFrom('claim_coverages').where('claim_id', '=', saved.id).execute();
      await tx.deleteFrom('claim_diagnoses').where('claim_id', '=', saved.id).execute();
      if (claim.lines.length) {
        await tx
          .insertInto('claim_lines')
          .values(
            claim.lines.map((l, i) => ({
              claim_id: saved.id,
              position: i + 1,
              code: l.code,
              modifiers: l.modifiers,
              units: l.units,
              unit_cents: l.unitCents,
              total_cents: l.totalCents
            }))
          )
          .execute();
      }
      if (claim.coverages.length) {
        await tx
          .insertInto('claim_coverages')
          .values(
            claim.coverages.map((c, i) => ({
              agency_id: saved.agency_id,
              claim_id: saved.id,
              position: i + 1,
              payer_name: c.payerName,
              payer_id: c.payerId,
              member_id: c.memberId,
              group_id: c.groupId,
              relationship: c.relationship,
              insured_first_name: c.insuredFirstName,
              insured_last_name: c.insuredLastName
            }))
          )
          .execute();
      }
      if (claim.diagnoses.length) {
        await tx
          .insertInto('claim_diagnoses')
          .values(claim.diagnoses.map((code, i) => ({ claim_id: saved.id, position: i + 1, code })))
          .execute();
      }
      return { id: saved.id, outcome: saved.inserted ? 'created' : 'replaced' };
    })
});
