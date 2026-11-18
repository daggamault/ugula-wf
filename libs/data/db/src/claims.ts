import {
  type ClaimInput,
  type ClaimStatus,
  type ClaimSubmission,
  type InsuredRelationship,
  type Submitter,
  submissionIssues
} from '@ugula/billing';
import { cancel, enqueueRuns, type RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { sqlExecutor } from './client.ts';
import type { Db } from './schema.ts';

export type StoredSubmission = ClaimSubmission & {
  id: string;
  revision: number;
  status: ClaimStatus;
};

const numberOrNull = (x: string | number | null) => (x === null ? null : Number(x));

export const findClaimSubmission = async (
  db: Db,
  agencyId: string,
  claimId: string
): Promise<StoredSubmission | null> => {
  const c = await db
    .selectFrom('claims as c')
    .select((eb) => [
      'c.id',
      'c.number',
      'c.revision',
      'c.status',
      'c.service_date',
      'c.loaded_miles',
      'c.transport_reason',
      'c.condition_codes',
      'c.weight_pounds',
      'c.patient_first_name',
      'c.patient_last_name',
      'c.patient_birth_date',
      'c.patient_sex',
      'c.patient_address_line',
      'c.patient_city',
      'c.patient_state',
      'c.patient_postal_code',
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
      sql<string[]>`array(${eb
        .selectFrom('claim_diagnoses as d')
        .select('d.code')
        .whereRef('d.claim_id', '=', 'c.id')
        .orderBy('d.position')})`.as('diagnoses'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as p', 'p.id', 'cc.payer_id')
          .select([
            'cc.payer_name',
            'p.name as directory_name',
            'p.payer_code',
            'p.claim_filing',
            'cc.member_id',
            'cc.group_id',
            'cc.relationship',
            'cc.insured_first_name',
            'cc.insured_last_name',
            'cc.status',
            'cc.adjudication'
          ])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('coverages'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_lines as l')
          .select(['l.code', 'l.modifiers', 'l.units', 'l.total_cents'])
          .whereRef('l.claim_id', '=', 'c.id')
          .orderBy('l.position')
      ).as('lines')
    ])
    .where('c.agency_id', '=', agencyId)
    .where('c.id', '=', claimId)
    .executeTakeFirst();
  if (!c) return null;
  return {
    id: c.id,
    number: c.number,
    revision: c.revision,
    status: c.status,
    serviceDate: c.service_date,
    loadedMiles: numberOrNull(c.loaded_miles),
    transportReason: c.transport_reason,
    conditionCodes: c.condition_codes,
    weightPounds: c.weight_pounds,
    patient: {
      firstName: c.patient_first_name,
      lastName: c.patient_last_name,
      birthDate: c.patient_birth_date,
      sex: c.patient_sex,
      addressLine: c.patient_address_line,
      city: c.patient_city,
      state: c.patient_state,
      postalCode: c.patient_postal_code
    },
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
    diagnoses: c.diagnoses,
    coverages: c.coverages.map((cc) => ({
      payerName: cc.payer_name,
      payer:
        cc.directory_name && cc.payer_code && cc.claim_filing
          ? { name: cc.directory_name, payerCode: cc.payer_code, claimFiling: cc.claim_filing }
          : null,
      memberId: cc.member_id,
      groupId: cc.group_id,
      relationship: cc.relationship as InsuredRelationship,
      insuredFirstName: cc.insured_first_name,
      insuredLastName: cc.insured_last_name,
      status: cc.status,
      adjudication: cc.adjudication
    })),
    lines: c.lines.map((l) => ({
      code: l.code,
      modifiers: l.modifiers,
      units: Number(l.units),
      totalCents: l.total_cents
    }))
  };
};

export const findSubmitter = async (db: Db, agencyId: string): Promise<Submitter | null> => {
  const p = await db
    .selectFrom('billing_profiles')
    .select([
      'organization_name',
      'npi',
      'tax_id',
      'address_line',
      'city',
      'state',
      'postal_code',
      'phone',
      'submitter_id',
      'receiver_id',
      'receiver_name',
      'is_production'
    ])
    .where('agency_id', '=', agencyId)
    .executeTakeFirst();
  return p
    ? {
        organizationName: p.organization_name,
        npi: p.npi,
        taxId: p.tax_id,
        addressLine: p.address_line,
        city: p.city,
        state: p.state,
        postalCode: p.postal_code,
        phone: p.phone,
        submitterId: p.submitter_id,
        receiverId: p.receiver_id,
        receiverName: p.receiver_name,
        production: p.is_production
      }
    : null;
};

export const checkClaim = async (db: Db, agencyId: string, claimId: string) => {
  const [claim, submitter] = await Promise.all([
    findClaimSubmission(db, agencyId, claimId),
    findSubmitter(db, agencyId)
  ]);
  return claim ? { claim, submitter, issues: submissionIssues(claim, submitter) } : null;
};

export const claimColumns = (c: Omit<ClaimInput, 'encounterId' | 'patientId'>) => ({
  classification: c.classification,
  service_date: c.serviceDate,
  level: c.level,
  is_emergency: c.emergency,
  loaded_miles: c.loadedMiles,
  origin_code: c.originCode,
  destination_code: c.destinationCode,
  transport_reason: c.transportReason,
  condition_codes: c.conditionCodes,
  weight_pounds: c.weightPounds,
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
  total_cents: c.totalCents,
  reasons: c.reasons
});

const REVIEW_PERMISSION = 'claims:approve';

export const cancelStaleReviews = async (
  tx: Db,
  boss: RunQueueClient,
  agencyId: string,
  encounterId: string,
  exceptRunId: string | null
) => {
  let q = tx
    .selectFrom('workflow_runs as r')
    .select('r.id')
    .where('r.agency_id', '=', agencyId)
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
    );
  if (exceptRunId) q = q.where('r.id', '<>', exceptRunId);
  const stale = await q.execute();
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    stale.map((r) => cancel(r.id))
  );
  return stale.length;
};

export const replaceClaimParts = async (
  tx: Db,
  agencyId: string,
  claimId: string,
  claim: Pick<ClaimInput, 'lines' | 'coverages' | 'diagnoses'>,
  keptPayers = 0
) => {
  await tx.deleteFrom('claim_lines').where('claim_id', '=', claimId).execute();
  await tx
    .deleteFrom('claim_coverages')
    .where('claim_id', '=', claimId)
    .where('position', '>', keptPayers)
    .execute();
  await tx.deleteFrom('claim_diagnoses').where('claim_id', '=', claimId).execute();
  const coverages = claim.coverages.slice(keptPayers);
  if (claim.lines.length) {
    await tx
      .insertInto('claim_lines')
      .values(
        claim.lines.map((l, i) => ({
          claim_id: claimId,
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
  if (coverages.length) {
    await tx
      .insertInto('claim_coverages')
      .values(
        coverages.map((c, i) => ({
          agency_id: agencyId,
          claim_id: claimId,
          position: keptPayers + i + 1,
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
      .values(claim.diagnoses.map((code, i) => ({ claim_id: claimId, position: i + 1, code })))
      .execute();
  }
};
