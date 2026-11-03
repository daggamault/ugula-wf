import {
  type BatchClaim,
  type BatchPayer,
  type ClaimCheck,
  type ClaimDetails,
  type ClaimEvent,
  claimIssues,
  claimProgress,
  INSURED_RELATIONSHIPS,
  MAX_CONTROL_NUMBER,
  nextClaimStep,
  type PendingSubmission,
  type Submitter
} from '@ugula/billing';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { DOCUMENTATION_COLUMNS, documentationOf } from './claim-documentation.ts';
import type { Db } from './schema.ts';

export type SubmissionEvent = {
  claimId: string;
  kind: 'submitted' | 'resubmitted';
  coverageId: string;
};

const readyClaim = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('claims as c')
    .innerJoin('patients as p', 'p.id', 'c.patient_id')
    .select((eb) => [
      'c.id',
      'c.number',
      'c.pcr_number',
      'c.emergency',
      'c.loaded_miles',
      'c.total_cents',
      'c.service_date',
      'c.origin_code',
      'c.destination_code',
      'c.pickup_address_line',
      'c.pickup_city',
      'c.pickup_state',
      'c.pickup_postal_code',
      'c.destination_name',
      'c.destination_address_line',
      'c.destination_city',
      'c.destination_state',
      'c.destination_postal_code',
      ...DOCUMENTATION_COLUMNS,
      'c.created_at',
      'p.first_name',
      'p.last_name',
      'p.birth_date',
      'p.gender',
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code',
      jsonArrayFrom(
        eb
          .selectFrom('claim_coverages as cc')
          .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
          .select([
            'cc.id',
            sql<string>`coalesce(dp.name, cc.payer_name)`.as('payer'),
            'dp.payer_id',
            'dp.claim_filing',
            'cc.member_id',
            'cc.group_id',
            sql<string>`cc.relationship`.as('relationship'),
            'cc.insured_first_name',
            'cc.insured_last_name'
          ])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('coverages'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_lines as l')
          .select(['l.code', 'l.units', 'l.unit_cents', 'l.total_cents'])
          .whereRef('l.claim_id', '=', 'c.id')
          .orderBy('l.position')
      ).as('lines'),
      sql<string[]>`array(${eb
        .selectFrom('claim_diagnoses as d')
        .select('d.code')
        .whereRef('d.claim_id', '=', 'c.id')
        .orderBy('d.position')})`.as('diagnoses')
    ])
    .where('c.tenant_id', '=', tenantId)
    .where('c.id', '=', id)
    .where('c.status', '=', 'ready');

export const findReadyClaim = (db: Db, tenantId: string, id: string) =>
  readyClaim(db, tenantId, id).executeTakeFirst();

export const lockReadyClaim = (db: Db, tenantId: string, id: string) =>
  readyClaim(db, tenantId, id).forUpdate('c').executeTakeFirst();

export type ReadyClaimRow = NonNullable<Awaited<ReturnType<typeof findReadyClaim>>>;

const profileColumns = [
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
  'production'
] as const;

export const findProfile = (db: Db, tenantId: string) =>
  db
    .selectFrom('billing_profiles')
    .select(profileColumns)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

export type ProfileRow = NonNullable<Awaited<ReturnType<typeof findProfile>>>;

export const toSubmitter = (p: ProfileRow): Submitter => ({
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
  production: p.production
});

export const allocateControlNumber = async (db: Db, tenantId: string) =>
  (
    await db
      .updateTable('billing_profiles')
      .set({ next_control_number: sql`next_control_number + 1` })
      .where('tenant_id', '=', tenantId)
      .where('next_control_number', '<=', MAX_CONTROL_NUMBER)
      .returning(sql<number>`next_control_number - 1`.as('control_number'))
      .executeTakeFirst()
  )?.control_number ?? null;

export const insertBatch = (
  db: Db,
  batch: {
    id: string;
    tenantId: string;
    controlNumber: number;
    totalCents: number;
    production: boolean;
    document: unknown;
    createdBy: string | null;
  }
) =>
  db
    .insertInto('claim_batches')
    .values({
      id: batch.id,
      tenant_id: batch.tenantId,
      control_number: batch.controlNumber,
      claim_count: 1,
      total_cents: batch.totalCents,
      production: batch.production,
      document: JSON.stringify(batch.document),
      created_by: batch.createdBy
    })
    .returning(['id', 'control_number', 'claim_count', 'total_cents', 'production', 'created_at'])
    .executeTakeFirstOrThrow();

export const insertSubmissionEvent = (
  db: Db,
  origin: { batchId: string | null; note: string; createdBy: string | null; sourceKey?: string },
  e: SubmissionEvent
) =>
  db
    .insertInto('claim_events')
    .values({
      claim_id: e.claimId,
      kind: e.kind,
      coverage_id: e.coverageId,
      note: origin.note,
      batch_id: origin.batchId,
      created_by: origin.createdBy,
      source_key: origin.sourceKey ?? null
    })
    .execute();

export const markSubmitted = (db: Db, id: string) =>
  db
    .updateTable('claims')
    .set({ status: 'submitted', updated_at: sql`now()` })
    .where('id', '=', id)
    .where('status', '=', 'ready')
    .execute();

export const batchKey = (tenantId: string, batchId: string, controlNumber: number) =>
  `batches/${tenantId}/${batchId}/837P-${String(controlNumber).padStart(9, '0')}.txt`;

type CoverageRow = ReadyClaimRow['coverages'][number];

const payerOf = (name: string, c: CoverageRow | undefined): BatchPayer => ({
  name,
  payerId: c?.payer_id ?? null,
  claimFiling: c?.claim_filing ?? null,
  memberId: c?.member_id ?? null,
  groupId: c?.group_id ?? null,
  relationship: INSURED_RELATIONSHIPS.find((r) => r === String(c?.relationship)) ?? '18',
  insuredFirstName: c?.insured_first_name ?? null,
  insuredLastName: c?.insured_last_name ?? null
});

export const detailsOf = (row: ReadyClaimRow): ClaimDetails => ({
  serviceDate: row.service_date,
  pickup: {
    name: null,
    addressLine: row.pickup_address_line,
    city: row.pickup_city,
    state: row.pickup_state,
    postalCode: row.pickup_postal_code
  },
  destination: {
    name: row.destination_name,
    addressLine: row.destination_address_line,
    city: row.destination_city,
    state: row.destination_state,
    postalCode: row.destination_postal_code
  },
  diagnoses: row.diagnoses,
  originDestination:
    row.origin_code && row.destination_code ? row.origin_code + row.destination_code : null,
  documentation: documentationOf(row)
});

const messages = (issues: ReturnType<typeof claimIssues>, level: string) =>
  issues.filter((i) => i.level === level).map((i) => i.message);

export const pendingClaim = (
  row: ReadyClaimRow,
  events: ClaimEvent[],
  check: ClaimCheck,
  now: Date
): PendingSubmission | null => {
  const ledger = {
    totalCents: row.total_cents,
    coverages: row.coverages.map((c) => ({ id: c.id, payer: c.payer })),
    events
  };
  const next = nextClaimStep(ledger, now);
  if (next.step !== 'submit') return null;
  const progress = claimProgress(ledger);
  const skipped = new Set(progress.skipped);
  const issues = claimIssues(check, now).filter(
    (i) => i.coverageId === null || !skipped.has(i.coverageId)
  );
  const coverageOf = (id: string) => row.coverages.find((c) => c.id === id);
  const claim: BatchClaim = {
    claimId: String(row.number),
    payerClaimNumber: progress.payerClaimNumber,
    payer: payerOf(next.coverage.payer, coverageOf(next.coverage.id)),
    priorPayers: progress.priorCoverages.map((c) => ({
      ...payerOf(c.payer, coverageOf(c.id)),
      paidCents: c.paidCents,
      adjustedCents: c.adjustedCents,
      paidOn: c.paidOn,
      adjustments: c.adjustments
    })),
    patient: {
      firstName: row.first_name,
      lastName: row.last_name,
      birthDate: row.birth_date,
      sex: row.gender,
      addressLine: row.address_line,
      city: row.city,
      state: row.state,
      postalCode: row.postal_code
    },
    details: detailsOf(row),
    emergency: row.emergency === true,
    loadedMiles: row.loaded_miles === null ? null : Number(row.loaded_miles),
    lines: row.lines.map((l) => ({
      code: l.code,
      units: Number(l.units),
      unitCents: l.unit_cents,
      totalCents: l.total_cents
    }))
  };
  return {
    id: row.id,
    claim,
    coverageId: next.coverage.id,
    pcrNumber: row.pcr_number,
    resubmission: progress.submittedBefore,
    totalCents: claim.lines.reduce((sum, l) => sum + l.totalCents, 0),
    issues: messages(issues, 'blocking'),
    warnings: messages(issues, 'warning')
  };
};
