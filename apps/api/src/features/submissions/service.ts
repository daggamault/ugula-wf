import { randomUUID } from 'node:crypto';
import {
  type BatchClaim,
  type BatchPayer,
  build270,
  build837,
  CLAIM_SIGNAL,
  type ClaimCheck,
  type ClaimDetails,
  type ClaimEvent,
  claimIssues,
  claimProgress,
  type EligibilityRequest,
  INSURED_RELATIONSHIPS,
  nextClaimStep,
  readX837Claim,
  SELF,
  type Submitter,
  submitterIssues
} from '@ugula/billing';
import { type Db, documentationOf, findClaimCheck } from '@ugula/db';
import type { Json } from '@ugula/graph';
import type { RunQueueClient } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import type { Evaluate } from '../../shared/evaluate.ts';
import { listLedgerEvents } from '../../shared/ledger.ts';
import { type Announce, announced } from '../../shared/live.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import { signalRuns } from '../../shared/runs.ts';
import {
  allocateControlNumber,
  type EligibilityClaimRow,
  findBatchDocument,
  findEligibilityClaim,
  findProfile,
  findReadyClaim,
  insertBatch,
  insertSubmissionEvent,
  lockReadyClaim,
  markSubmitted,
  type ProfileRow,
  type ReadyClaimRow,
  type SubmissionEvent
} from './queries.ts';

type SubmissionServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  now: () => Date;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>;
  announce: Announce;
  evaluate: Evaluate;
};

export const MAP_837P = { key: 'billing.map-837p', version: 1 };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

type PendingClaim = {
  id: string;
  claim: BatchClaim;
  coverageId: string;
  pcrNumber: string | null;
  resubmission: boolean;
  changedSinceApproval: boolean;
  issues: string[];
  warnings: string[];
};

const notReady = fail('conflict', 'This claim is not ready to submit');

const changedSinceApproval = fail(
  'conflict',
  'Something was logged on this claim since it was approved; refresh and check it again'
);

const BATCH_CONTENT_TYPE = 'application/edi-x12';

export const batchKey = (tenantId: string, batchId: string, controlNumber: number) =>
  `batches/${tenantId}/${batchId}/837P-${String(controlNumber).padStart(9, '0')}.txt`;

export const eligibilityRequests = (
  row: EligibilityClaimRow,
  today: string
): EligibilityRequest[] =>
  row.coverages.flatMap((c) => {
    if (!c.payer_id || !c.member_id) return [];
    const self = c.relationship === SELF;
    const lastName = self ? row.last_name : c.insured_last_name;
    if (!lastName) return [];
    return [
      {
        trace: c.id,
        payer: { name: c.payer, payerId: c.payer_id },
        subscriber: {
          lastName,
          firstName: self ? row.first_name : c.insured_first_name,
          memberId: c.member_id,
          birthDate: self ? row.birth_date : null,
          sex: self ? row.gender : null
        },
        serviceDate: row.service_date ?? today
      }
    ];
  });

const toSubmitter = (p: ProfileRow): Submitter => ({
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
): PendingClaim | null => {
  const ledger = {
    totalCents: row.total_cents,
    coverages: row.coverages.map((c) => ({ id: c.id, payer: c.payer })),
    events
  };
  const next = nextClaimStep(ledger, now);
  if (next.step !== 'submit' && next.step !== 'submitDue') return null;
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
    changedSinceApproval: events.some((e) => Date.parse(e.at) > (progress.approvedAt ?? 0)),
    issues: messages(issues, 'blocking'),
    warnings: messages(issues, 'warning')
  };
};

const describe = (p: PendingClaim) => ({
  id: p.id,
  pcrNumber: p.pcrNumber,
  patient: `${p.claim.patient.firstName} ${p.claim.patient.lastName}`,
  serviceDate: p.claim.details.serviceDate,
  payer: p.claim.payer.name,
  totalCents: p.claim.lines.reduce((sum, l) => sum + l.totalCents, 0),
  resubmission: p.resubmission,
  issues: p.issues,
  warnings: p.warnings
});

const submissionOf = (p: PendingClaim): SubmissionEvent => ({
  claimId: p.id,
  kind: p.resubmission ? 'resubmitted' : 'submitted',
  coverageId: p.coverageId
});

export const createSubmissionService = ({
  db,
  boss,
  now,
  blobs,
  announce,
  evaluate
}: SubmissionServiceDeps) => {
  const map837 = async (tx: Db, tenantId: string, claim: BatchClaim) => {
    const [x] = await evaluate(
      tx,
      tenantId,
      MAP_837P,
      [{ claim: claim as unknown as Json }],
      'x837'
    );
    try {
      return readX837Claim(x);
    } catch (err) {
      throw new Error(`Claim ${claim.claimId}: ${messageOf(err)}`);
    }
  };

  const write = <T>(tenantId: string, claimId: string, work: (tx: Db) => Promise<Result<T>>) =>
    announced(announce, tenantId, db.transaction().execute(work), () => [
      { kind: 'claim', id: claimId }
    ]);

  const pendingOf = async (tx: Db, tenantId: string, row: ReadyClaimRow | undefined) => {
    if (!row) return null;
    const [events, check] = await Promise.all([
      listLedgerEvents(tx, row.id),
      findClaimCheck(tx, tenantId, row.id)
    ]);
    return check ? pendingClaim(row, events, check, now()) : null;
  };

  const record = async (
    tx: Db,
    tenantId: string,
    origin: { batchId: string | null; note: string; createdBy: string },
    event: SubmissionEvent
  ) => {
    await insertSubmissionEvent(tx, origin, event);
    await markSubmitted(tx, event.claimId);
    await signalRuns(tx, boss, {
      tenantId,
      name: CLAIM_SIGNAL,
      key: event.claimId,
      payload: null
    });
  };

  return {
    pending: async (tenantId: string, claimId: string) => {
      const [profile, row] = await Promise.all([
        findProfile(db, tenantId),
        findReadyClaim(db, tenantId, claimId)
      ]);
      const pending = await pendingOf(db, tenantId, row);
      return ok({
        issues: submitterIssues(profile ? toSubmitter(profile) : null),
        claim: pending ? describe(pending) : null
      });
    },

    document: async (tenantId: string, id: string) => {
      const found = await findBatchDocument(db, tenantId, id);
      if (!found) return fail('not_found', 'Batch not found');
      const ref = found.document as BlobRef;
      return ok({
        bytes: await blobs.getBytes(ref),
        contentType: ref.contentType,
        name: ref.key.split('/').at(-1) ?? 'batch.txt'
      });
    },

    create: async (tenantId: string, userId: string, claimId: string) => {
      const [profile, row] = await Promise.all([
        findProfile(db, tenantId),
        findReadyClaim(db, tenantId, claimId)
      ]);
      const submitter = profile ? toSubmitter(profile) : null;
      const problems = submitterIssues(submitter);
      if (!submitter || problems.length) {
        return fail('invalid', problems[0] ?? 'Add a billing profile in Settings', {
          issues: problems
        });
      }
      const pending = await pendingOf(db, tenantId, row);
      if (!pending) return notReady;
      if (pending.issues.length) {
        return fail('invalid', pending.issues[0] ?? 'This claim is missing data', {
          issues: pending.issues
        });
      }
      let mapped: Awaited<ReturnType<typeof map837>>;
      try {
        mapped = await map837(db, tenantId, pending.claim);
      } catch (err) {
        return fail('invalid', `The 837P mapping failed: ${messageOf(err)}`);
      }
      return write(tenantId, claimId, async (tx) => {
        const current = await pendingOf(tx, tenantId, await lockReadyClaim(tx, tenantId, claimId));
        if (current?.coverageId !== pending.coverageId) return notReady;
        const controlNumber = await allocateControlNumber(tx, tenantId);
        if (controlNumber === null) {
          return fail('conflict', 'Batch control numbers are used up; contact support');
        }
        const id = randomUUID();
        const file = build837(submitter, [mapped], { controlNumber, createdAt: now() });
        const document = await blobs.putBytes(
          batchKey(tenantId, id, controlNumber),
          new TextEncoder().encode(file),
          BATCH_CONTENT_TYPE
        );
        const batch = await insertBatch(tx, {
          id,
          tenantId,
          controlNumber,
          totalCents: describe(current).totalCents,
          production: submitter.production,
          document,
          createdBy: userId
        });
        await record(
          tx,
          tenantId,
          { batchId: batch.id, note: `837P file #${controlNumber}`, createdBy: userId },
          submissionOf(current)
        );
        return ok({ batch });
      });
    },

    eligibility: async (tenantId: string, claimId: string) => {
      const [profile, row] = await Promise.all([
        findProfile(db, tenantId),
        findEligibilityClaim(db, tenantId, claimId)
      ]);
      if (!row) return fail('not_found', 'Claim not found');
      const submitter = profile ? toSubmitter(profile) : null;
      const problems = submitterIssues(submitter);
      if (!submitter || problems.length) {
        return fail('invalid', problems[0] ?? 'Add a billing profile in Settings', {
          issues: problems
        });
      }
      const requests = eligibilityRequests(row, now().toISOString().slice(0, 10));
      if (!requests.length) {
        return fail(
          'invalid',
          'No payer on this claim has a directory payer and member ID to check eligibility with'
        );
      }
      const controlNumber = await allocateControlNumber(db, tenantId);
      if (controlNumber === null) {
        return fail('conflict', 'Batch control numbers are used up; contact support');
      }
      return ok({
        name: `eligibility-${row.number}-${controlNumber}.x12`,
        file: build270(submitter, requests, { controlNumber, createdAt: now() }),
        payers: requests.map((r) => r.payer.name)
      });
    },

    markSubmitted: (tenantId: string, userId: string, claimId: string, note: string) =>
      write(tenantId, claimId, async (tx) => {
        const pending = await pendingOf(tx, tenantId, await lockReadyClaim(tx, tenantId, claimId));
        if (!pending) return notReady;
        if (pending.changedSinceApproval) return changedSinceApproval;
        await record(
          tx,
          tenantId,
          { batchId: null, note: note || 'Submitted outside an 837P file', createdBy: userId },
          submissionOf(pending)
        );
        return ok({ payer: pending.claim.payer.name });
      })
  };
};

export type SubmissionService = ReturnType<typeof createSubmissionService>;
