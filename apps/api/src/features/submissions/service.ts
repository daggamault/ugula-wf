import {
  type BatchClaim,
  build837,
  CLAIM_SIGNAL,
  type ClaimDetails,
  type ClaimEvent,
  type ClaimEventKind,
  claimIssues,
  claimProgress,
  MAX_CONTROL_NUMBER,
  nextClaimStep,
  readX837Claim,
  type Sex,
  type Submitter,
  submitterIssues
} from '@ugula/billing';
import type { BlobRef, BlobStore } from '@ugula/blobs';
import type { Db } from '@ugula/db';
import type { Json } from '@ugula/graph';
import type { JobBoss } from '@ugula/jobs';
import type { Evaluate } from '../../shared/evaluate.ts';
import { type Announce, announced } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import { signalRuns } from '../../shared/runs.ts';
import {
  findBatchDocument,
  findProfile,
  insertBatch,
  insertSubmissionEvents,
  listBatches,
  listLedgerEvents,
  listOpenClaims,
  lockOpenClaims,
  lockProfile,
  nextControlNumber,
  type OpenClaimRow,
  type ProfileRow,
  type SubmissionEvent
} from './queries.ts';
import type { BatchSort } from './schemas.ts';

export type SubmissionServiceDeps = {
  db: Db;
  boss: JobBoss;
  now: () => Date;
  blobs: Pick<BlobStore, 'putBytes' | 'getBytes'>;
  announce: Announce;
  evaluate: Evaluate;
};

export const MAP_837P = { key: 'billing.map-837p', version: 1 };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

type LedgerRow = Awaited<ReturnType<typeof listLedgerEvents>>[number];

export type PendingClaim = {
  claim: BatchClaim;
  coverageId: string;
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
  coverageId: e.coverage_id,
  paidCents: e.paid_cents,
  adjustedCents: e.adjusted_cents,
  at: new Date(e.created_at).toISOString()
});

export const detailsOf = (row: OpenClaimRow): ClaimDetails => ({
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
    row.origin_code && row.destination_code ? row.origin_code + row.destination_code : null
});

export const pendingClaims = (
  rows: OpenClaimRow[],
  events: LedgerRow[],
  now: Date
): PendingClaim[] => {
  const byClaim = Map.groupBy(events, (e) => e.claim_id);
  return rows.flatMap((row) => {
    const ledger = {
      totalCents: row.total_cents,
      coverages: row.coverages.map((c) => ({ id: c.id, payer: c.payer })),
      events: (byClaim.get(row.id) ?? []).map(toLedgerEvent)
    };
    const next = nextClaimStep(ledger, now);
    if (next.step !== 'submit') return [];
    const progress = claimProgress(ledger);
    const coverage = row.coverages.find((c) => c.id === next.coverage.id);
    const claim: BatchClaim = {
      claimId: row.id,
      priorPayers: progress.priorCoverages.map((c) => c.payer),
      payer: {
        name: next.coverage.payer,
        payerId: coverage?.payer_id ?? null,
        claimFiling: coverage?.claim_filing ?? null
      },
      memberId: coverage?.member_id ?? null,
      groupId: coverage?.group_id ?? null,
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
      details: detailsOf(row),
      emergency: row.emergency,
      loadedMiles: row.loaded_miles === null ? null : Number(row.loaded_miles),
      lines: row.lines.map((l) => ({
        code: l.code,
        units: Number(l.units),
        unitCents: l.unit_cents,
        totalCents: l.total_cents
      }))
    };
    return [
      {
        claim,
        coverageId: next.coverage.id,
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
  const map837 = async (tx: Db, tenantId: string, claims: BatchClaim[]) =>
    (
      await evaluate(
        tx,
        tenantId,
        MAP_837P,
        claims.map((claim) => ({ claim: claim as unknown as Json })),
        'x837'
      )
    ).map((x, i) => {
      try {
        return readX837Claim(x);
      } catch (err) {
        throw new Error(`Claim ${claims[i]?.claimId}: ${messageOf(err)}`);
      }
    });

  // A batch can touch many claims, so it reports them together (a null id).
  const write = <T>(
    tenantId: string,
    claimId: string | null,
    work: (tx: Db) => Promise<Result<T>>
  ) =>
    announced(announce, tenantId, db.transaction().execute(work), () => [
      { kind: 'claim', id: claimId }
    ]);

  const pendingOf = async (tx: Db, rows: OpenClaimRow[]) => {
    const events = await listLedgerEvents(
      tx,
      rows.map((r) => r.id)
    );
    return pendingClaims(rows, events, now());
  };

  const record = async (
    tx: Db,
    tenantId: string,
    origin: { batchId: string | null; note: string; createdBy: string },
    events: SubmissionEvent[]
  ) => {
    await insertSubmissionEvents(tx, origin, events);
    for (const e of events) {
      await signalRuns(tx, boss, { tenantId, name: CLAIM_SIGNAL, key: e.claimId, payload: null });
    }
  };

  return {
    pending: async (tenantId: string, claimId?: string) => {
      const [profile, rows] = await Promise.all([
        findProfile(db, tenantId),
        listOpenClaims(db, tenantId, claimId)
      ]);
      const pending = await pendingOf(db, rows);
      return ok({
        issues: submitterIssues(profile ? toSubmitter(profile) : null),
        claims: pending.map(describe)
      });
    },

    list: async (tenantId: string, page: PageRequest<BatchSort>) =>
      ok(await listBatches(db, tenantId, page)),

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
      write(tenantId, null, async (tx) => {
        const profile = await lockProfile(tx, tenantId);
        const submitter = profile ? toSubmitter(profile) : null;
        const problems = submitterIssues(submitter);
        if (!submitter || problems.length) {
          return fail('invalid', problems[0] ?? 'Add a billing profile in Settings', {
            issues: problems
          });
        }
        const ids = [...new Set(claimIds)];
        const ready = (await pendingOf(tx, await lockOpenClaims(tx, tenantId, ids))).filter(
          (p) => !p.issues.length
        );
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
        let mapped: Awaited<ReturnType<typeof map837>>;
        try {
          mapped = await map837(tx, tenantId, claims);
        } catch (err) {
          return fail('invalid', `The 837P mapping failed: ${messageOf(err)}`);
        }
        const file = build837(submitter, mapped, { controlNumber, createdAt });
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
      write(tenantId, claimId, async (tx) => {
        const [pending] = await pendingOf(tx, await lockOpenClaims(tx, tenantId, [claimId]));
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
