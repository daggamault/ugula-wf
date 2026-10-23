import {
  type BatchClaim,
  build837,
  type ClaimEvent,
  type ClaimEventKind,
  claimIssues,
  claimProgress,
  MAX_CONTROL_NUMBER,
  nextClaimStep,
  readCoverages,
  readPricedLines,
  readStoredDetails,
  type Sex,
  type Submitter,
  submitterIssues
} from '@ugula/billing';
import type { BlobRef, BlobStore } from '@ugula/blobs';
import type { Db } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import { fail, ok } from '../../shared/result.ts';
import { signalRuns } from '../../shared/runs.ts';
import {
  findBatchDocument,
  findProfile,
  insertBatch,
  insertSubmissionEvents,
  listBatches,
  listLedgerEvents,
  listOpenClaims,
  listPayerDirectory,
  lockOpenClaims,
  lockProfile,
  nextControlNumber,
  type OpenClaimRow,
  type ProfileRow,
  type SubmissionEvent
} from './queries.ts';

export type SubmissionServiceDeps = {
  db: Db;
  boss: JobBoss;
  now: () => Date;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>;
};

type LedgerRow = Awaited<ReturnType<typeof listLedgerEvents>>[number];

type DirectoryRow = Awaited<ReturnType<typeof listPayerDirectory>>[number];

export type PendingClaim = {
  claim: BatchClaim;
  pcrNumber: string | null;
  resubmission: boolean;
  issues: string[];
};

const SEXES: readonly string[] = ['F', 'M', 'U'];

export const BATCH_CONTENT_TYPE = 'application/edi-x12';

export const batchKey = (tenantId: string, controlNumber: number) =>
  `batches/${tenantId}/837P-${String(controlNumber).padStart(9, '0')}.txt`;

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

const toLedgerEvent = (e: LedgerRow): ClaimEvent => ({
  kind: e.kind as ClaimEventKind,
  payer: e.payer,
  paidCents: e.paid_cents,
  adjustedCents: e.adjusted_cents,
  at: new Date(e.created_at).toISOString()
});

export const pendingClaims = (
  rows: OpenClaimRow[],
  events: LedgerRow[],
  directory: DirectoryRow[],
  now: Date
): PendingClaim[] => {
  const byClaim = Map.groupBy(events, (e) => e.claim_id);
  const payers = new Map(directory.map((p) => [p.name.toLowerCase(), p]));
  return rows.flatMap((row) => {
    const ledger = {
      totalCents: row.total_cents,
      payers: row.payers,
      events: (byClaim.get(row.id) ?? []).map(toLedgerEvent)
    };
    const next = nextClaimStep(ledger, now);
    if (next.step !== 'submit') return [];
    const progress = claimProgress(ledger);
    const key = next.payer.toLowerCase();
    const coverage = readCoverages({ coverages: row.coverages }).find(
      (c) => c.payer.toLowerCase() === key
    );
    const listed = payers.get(key);
    const claim: BatchClaim = {
      claimId: row.id,
      priorPayers: progress.priorPayers,
      payer: {
        name: next.payer,
        payerId: listed?.payer_id ?? null,
        claimFiling: listed?.claim_filing ?? null
      },
      memberId: coverage?.memberId ?? null,
      groupId: coverage?.groupId ?? null,
      patient: {
        firstName: row.first_name,
        lastName: row.last_name,
        birthDate: row.birth_date,
        sex: row.gender && SEXES.includes(row.gender) ? (row.gender as Sex) : null,
        addressLine: row.address_line,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code
      },
      details: readStoredDetails(row.details),
      emergency: row.emergency,
      loadedMiles: row.loaded_miles === null ? null : Number(row.loaded_miles),
      lines: readPricedLines(row.lines)
    };
    return [
      {
        claim,
        pcrNumber: row.pcr_number,
        resubmission: progress.submittedBefore,
        issues: claimIssues(claim)
      }
    ];
  });
};

const describe = (p: PendingClaim) => ({
  id: p.claim.claimId,
  pcrNumber: p.pcrNumber,
  patient: `${p.claim.patient.firstName} ${p.claim.patient.lastName}`,
  serviceDate: p.claim.details.serviceDate,
  payer: p.claim.payer.name,
  totalCents: p.claim.lines.reduce((sum, l) => sum + l.totalCents, 0),
  resubmission: p.resubmission,
  issues: p.issues
});

const submissionOf = (p: PendingClaim): SubmissionEvent => ({
  claimId: p.claim.claimId,
  kind: p.resubmission ? 'resubmitted' : 'submitted',
  payer: p.claim.payer.name
});

export const createSubmissionService = ({ db, boss, now, blobs }: SubmissionServiceDeps) => {
  const pendingOf = async (tx: Db, tenantId: string, rows: OpenClaimRow[]) => {
    const [events, directory] = await Promise.all([
      listLedgerEvents(
        tx,
        rows.map((r) => r.id)
      ),
      listPayerDirectory(tx, tenantId)
    ]);
    return pendingClaims(rows, events, directory, now());
  };

  const record = async (
    tx: Db,
    tenantId: string,
    origin: { batchId: string | null; note: string; createdBy: string },
    events: SubmissionEvent[]
  ) => {
    await insertSubmissionEvents(tx, origin, events);
    for (const e of events) {
      await signalRuns(tx, boss, { tenantId, name: 'claim', key: e.claimId, payload: null });
    }
  };

  return {
    pending: async (tenantId: string) => {
      const [profile, rows] = await Promise.all([
        findProfile(db, tenantId),
        listOpenClaims(db, tenantId)
      ]);
      const pending = await pendingOf(db, tenantId, rows);
      return ok({
        issues: submitterIssues(profile ? toSubmitter(profile) : null),
        claims: pending.map(describe)
      });
    },

    list: async (tenantId: string, limit: number) =>
      ok({ batches: await listBatches(db, tenantId, limit) }),

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

    create: (tenantId: string, userId: string, claimIds: string[]) =>
      db.transaction().execute(async (tx) => {
        const profile = await lockProfile(tx, tenantId);
        const submitter = profile ? toSubmitter(profile) : null;
        const problems = submitterIssues(submitter);
        if (!submitter || problems.length) {
          return fail('invalid', problems[0] ?? 'Add a billing profile in Settings', {
            issues: problems
          });
        }
        const ids = [...new Set(claimIds)];
        const ready = (
          await pendingOf(tx, tenantId, await lockOpenClaims(tx, tenantId, ids))
        ).filter((p) => !p.issues.length);
        const stale = ids.filter((id) => !ready.some((p) => p.claim.claimId === id));
        if (stale.length) {
          return fail(
            'conflict',
            stale.length === 1
              ? 'A selected claim is no longer ready to submit'
              : `${stale.length} selected claims are no longer ready to submit`,
            { claimIds: stale }
          );
        }
        const controlNumber = await nextControlNumber(tx, tenantId);
        if (controlNumber > MAX_CONTROL_NUMBER) {
          return fail('conflict', 'Batch control numbers are used up; contact support');
        }
        const createdAt = now();
        const claims = ready.map((p) => p.claim);
        const file = build837(submitter, claims, { controlNumber, createdAt });
        const document = await blobs.putBytes(
          batchKey(tenantId, controlNumber),
          new TextEncoder().encode(file),
          BATCH_CONTENT_TYPE
        );
        const batch = await insertBatch(tx, {
          tenantId,
          controlNumber,
          claimCount: claims.length,
          totalCents: ready.reduce((sum, p) => sum + describe(p).totalCents, 0),
          production: submitter.production,
          document,
          createdBy: userId
        });
        await record(
          tx,
          tenantId,
          { batchId: batch.id, note: `837P batch #${controlNumber}`, createdBy: userId },
          ready.map(submissionOf)
        );
        return ok({ batch });
      }),

    markSubmitted: (tenantId: string, userId: string, claimId: string, note: string) =>
      db.transaction().execute(async (tx) => {
        const [pending] = await pendingOf(
          tx,
          tenantId,
          await lockOpenClaims(tx, tenantId, [claimId])
        );
        if (!pending) return fail('conflict', 'This claim is not waiting to be submitted');
        await record(
          tx,
          tenantId,
          { batchId: null, note: note || 'Submitted outside an 837P batch', createdBy: userId },
          [submissionOf(pending)]
        );
        return ok({ payer: pending.claim.payer.name });
      })
  };
};

export type SubmissionService = ReturnType<typeof createSubmissionService>;
