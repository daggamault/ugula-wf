import type { ClaimInput, ClaimStore, InsuredRelationship } from '@ugula/billing';
import { checkClaim, type Database, sqlExecutor } from '@ugula/db';
import { cancel, enqueueRuns, type RunQueueClient } from '@ugula/run-queue';
import { type Kysely, type Selectable, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type PatientSnapshot = Pick<
  Selectable<Database['claims']>,
  | 'patient_first_name'
  | 'patient_last_name'
  | 'patient_birth_date'
  | 'patient_sex'
  | 'patient_address_line'
  | 'patient_city'
  | 'patient_state'
  | 'patient_postal_code'
>;

const patientSnapshot = (tx: Kysely<Database>, runId: string, patientId: string) =>
  tx
    .selectFrom('patients')
    .select([
      'first_name as patient_first_name',
      'last_name as patient_last_name',
      'birth_date as patient_birth_date',
      'gender as patient_sex',
      'address_line as patient_address_line',
      'city as patient_city',
      'state as patient_state',
      'postal_code as patient_postal_code'
    ])
    .where('agency_id', '=', runAgency(tx, runId))
    .where('id', '=', patientId)
    .executeTakeFirst();

const claimColumns = (c: ClaimInput, patient: PatientSnapshot) => ({
  ...patient,
  pickup_name: c.pickup.name,
  pickup_address_line: c.pickup.line,
  pickup_city: c.pickup.city,
  pickup_state: c.pickup.state,
  pickup_postal_code: c.pickup.postalCode,
  destination_name: c.destination.name,
  destination_address_line: c.destination.line,
  destination_city: c.destination.city,
  destination_state: c.destination.state,
  destination_postal_code: c.destination.postalCode,
  prior_authorization: c.priorAuthorization,
  is_signature_on_file: c.signatureOnFile,
  note: c.note,
  patient_id: c.patientId,
  classification: c.classification,
  service_date: c.serviceDate,
  level: c.level,
  is_emergency: c.emergency,
  transport_reason: c.transportReason,
  condition_codes: c.conditionCodes,
  weight_pounds: c.weightPounds,
  loaded_miles: c.loadedMiles,
  origin_code: c.originCode,
  destination_code: c.destinationCode,
  total_cents: c.totalCents,
  reasons: c.reasons
});

const REVIEW_PERMISSION = 'claims:approve';

const supersededReviews = (
  tx: Kysely<Database>,
  agencyId: string,
  runId: string,
  encounterId: string
) =>
  tx
    .selectFrom('workflow_runs as r')
    .select('r.id')
    .where('r.agency_id', '=', agencyId)
    .where('r.id', '<>', runId)
    .where('r.status', '=', 'suspended')
    .where(sql<string>`r.inputs ->> 'encounterId'`, '=', encounterId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('tasks as t')
          .select(sql`1`.as('one'))
          .whereRef('t.run_id', '=', 'r.id')
          .where('t.status', '=', 'open')
          .where('t.permission', '=', REVIEW_PERMISSION)
      )
    )
    .execute();

const numberOrNull = (x: string | number | null) => (x === null ? null : Number(x));

const issuesOf = async (db: Kysely<Database>, runId: string, claimId: string) => {
  if (!isUuid(claimId)) return null;
  const run = await runAgency(db, runId).executeTakeFirst();
  return run ? ((await checkClaim(db, run.agency_id, claimId))?.issues ?? null) : null;
};

export const createClaimStore = (db: Kysely<Database>, boss: RunQueueClient): ClaimStore => ({
  findClaim: async (runId, claimId) => {
    if (!isUuid(claimId)) return null;
    const c = await db
      .selectFrom('claims as c')
      .select((eb) => [
        'c.id',
        'c.revision',
        'c.encounter_id',
        'c.patient_id',
        'c.classification',
        'c.service_date',
        'c.level',
        'c.is_emergency',
        'c.loaded_miles',
        'c.origin_code',
        'c.destination_code',
        'c.transport_reason',
        'c.condition_codes',
        'c.weight_pounds',
        'c.pickup_name',
        'c.pickup_address_line',
        'c.pickup_city',
        'c.pickup_state',
        'c.pickup_postal_code',
        'c.destination_name',
        'c.destination_address_line',
        'c.destination_city',
        'c.destination_state',
        'c.destination_postal_code',
        'c.prior_authorization',
        'c.is_signature_on_file',
        'c.note',
        'c.total_cents',
        'c.reasons',
        sql<string[]>`array(${eb
          .selectFrom('claim_diagnoses as d')
          .select('d.code')
          .whereRef('d.claim_id', '=', 'c.id')
          .orderBy('d.position')})`.as('diagnoses'),
        jsonArrayFrom(
          eb
            .selectFrom('claim_coverages as cc')
            .select([
              'cc.payer_id',
              'cc.payer_name',
              'cc.member_id',
              'cc.group_id',
              'cc.relationship',
              'cc.insured_first_name',
              'cc.insured_last_name'
            ])
            .whereRef('cc.claim_id', '=', 'c.id')
            .orderBy('cc.position')
        ).as('coverages'),
        jsonArrayFrom(
          eb
            .selectFrom('claim_lines as l')
            .select(['l.code', 'l.modifiers', 'l.units', 'l.unit_cents', 'l.total_cents'])
            .whereRef('l.claim_id', '=', 'c.id')
            .orderBy('l.position')
        ).as('lines')
      ])
      .where('c.id', '=', claimId)
      .where('c.agency_id', '=', runAgency(db, runId))
      .executeTakeFirst();
    return c
      ? {
          id: c.id,
          revision: c.revision,
          encounterId: c.encounter_id,
          patientId: c.patient_id,
          classification: c.classification,
          serviceDate: c.service_date,
          level: c.level,
          emergency: c.is_emergency,
          loadedMiles: numberOrNull(c.loaded_miles),
          originCode: c.origin_code,
          destinationCode: c.destination_code,
          diagnoses: c.diagnoses,
          transportReason: c.transport_reason,
          conditionCodes: c.condition_codes,
          weightPounds: c.weight_pounds,
          pickup: {
            name: c.pickup_name,
            line: c.pickup_address_line,
            city: c.pickup_city,
            state: c.pickup_state,
            postalCode: c.pickup_postal_code
          },
          destination: {
            name: c.destination_name,
            line: c.destination_address_line,
            city: c.destination_city,
            state: c.destination_state,
            postalCode: c.destination_postal_code
          },
          priorAuthorization: c.prior_authorization,
          signatureOnFile: c.is_signature_on_file,
          note: c.note,
          coverages: c.coverages.map((cc) => ({
            payerId: cc.payer_id,
            payerName: cc.payer_name,
            memberId: cc.member_id,
            groupId: cc.group_id,
            relationship: cc.relationship as InsuredRelationship,
            insuredFirstName: cc.insured_first_name,
            insuredLastName: cc.insured_last_name
          })),
          lines: c.lines.map((l) => ({
            code: l.code,
            modifiers: l.modifiers,
            units: Number(l.units),
            unitCents: l.unit_cents,
            totalCents: l.total_cents
          })),
          totalCents: c.total_cents,
          reasons: c.reasons
        }
      : null;
  },
  saveClaim: (runId, claim) =>
    db.transaction().execute(async (tx) => {
      if (!isUuid(claim.encounterId))
        throw new Error(`Encounter ${claim.encounterId} does not exist`);
      if (!isUuid(claim.patientId)) throw new Error(`Patient ${claim.patientId} does not exist`);
      const unknown = claim.coverages.find((c) => c.payerId !== null && !isUuid(c.payerId));
      if (unknown) throw new Error(`Payer ${unknown.payerId} does not exist`);
      const patient = await patientSnapshot(tx, runId, claim.patientId);
      if (!patient) throw new Error(`Patient ${claim.patientId} does not exist`);
      const saved = await tx
        .insertInto('claims')
        .values({
          agency_id: runAgency(tx, runId),
          encounter_id: claim.encounterId,
          ...claimColumns(claim, patient)
        })
        .onConflict((oc) =>
          oc.columns(['agency_id', 'encounter_id']).doUpdateSet({
            ...claimColumns(claim, patient),
            status: 'needs_review',
            revision: sql`claims.revision + 1`,
            reviewed_by: null,
            reviewed_at: null,
            review_note: null,
            updated_at: sql`now()`
          })
        )
        .returning(['id', 'agency_id', 'revision', sql<boolean>`xmax = 0`.as('inserted')])
        .executeTakeFirstOrThrow();
      if (!saved.inserted) {
        const stale = await supersededReviews(tx, saved.agency_id, runId, claim.encounterId);
        await enqueueRuns(
          boss,
          sqlExecutor(tx),
          stale.map((r) => cancel(r.id))
        );
      }
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
      return {
        id: saved.id,
        revision: saved.revision,
        outcome: saved.inserted ? 'created' : 'replaced'
      };
    }),
  checkClaim: (runId, claimId) => issuesOf(db, runId, claimId),
  reviewClaim: async (runId, review) => {
    if (!isUuid(review.claimId)) throw new Error(`Claim ${review.claimId} does not exist`);
    if (!isUuid(review.reviewedBy)) throw new Error(`User ${review.reviewedBy} does not exist`);
    if (review.decision === 'approved' && (await issuesOf(db, runId, review.claimId))?.length) {
      return 'notReady';
    }
    const decided = await db
      .updateTable('claims')
      .set({
        status: review.decision,
        reviewed_by: review.reviewedBy,
        reviewed_at: sql`now()`,
        review_note: review.note,
        updated_at: sql`now()`
      })
      .where('id', '=', review.claimId)
      .where('agency_id', '=', runAgency(db, runId))
      .where('revision', '=', review.revision)
      .where('status', '=', 'needs_review')
      .returning('id')
      .executeTakeFirst();
    return decided ? 'recorded' : 'superseded';
  }
});
