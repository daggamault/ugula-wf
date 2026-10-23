import { CLAIM_SIGNAL, type ClaimEventKind, nextClaimStep } from '@ugula/billing';
import type { BlobRef, BlobStore } from '@ugula/blobs';
import { type Db, findPublishedGraphs, sqlExecutor } from '@ugula/db';
import { enqueueRuns, type JobBoss, resume } from '@ugula/jobs';
import { type Announce, announced } from '../../shared/live.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import { signalRuns, startRun } from '../../shared/runs.ts';
import {
  type ClaimFilters,
  type ClaimResponse,
  type CoverageRow,
  claimBalance,
  findClaim,
  findEventDocument,
  hasResponse,
  insertResponse,
  listClaimEvents,
  listClaims,
  listCoverages,
  lockClaim,
  type PayerOrder,
  reorderCoverages,
  resolveMootTasks,
  saveBillingData,
  setCycleRun
} from './queries.ts';
import type { BillingData } from './schemas.ts';

export type ClaimServiceDeps = {
  db: Db;
  boss: JobBoss;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes'>;
  announce: Announce;
};

const CYCLE_WORKFLOW = { key: 'billing.cycle-claim', version: 1 };

const LIVE_CYCLE = new Set(['running', 'suspended', 'faulted']);

const notFound = fail('not_found', 'Claim not found');
const closed = fail('conflict', 'Claim is already closed');

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const planPayerOrder = (
  existing: readonly CoverageRow[],
  payers: readonly string[]
): PayerOrder & { removed: CoverageRow[] } => {
  const byName = new Map(existing.map((c) => [c.payer.toLowerCase(), c]));
  const keep: PayerOrder['keep'] = [];
  const add: PayerOrder['add'] = [];
  payers.forEach((payer, i) => {
    const found = byName.get(payer.toLowerCase());
    if (found) keep.push({ id: found.id, position: i + 1 });
    else add.push({ payer, position: i + 1 });
  });
  const kept = new Set(keep.map((c) => c.id));
  const removed = existing.filter((c) => !kept.has(c.id));
  return { keep, add, remove: removed.map((c) => c.id), removed };
};

export const createClaimService = ({ db, boss, now, blobs, announce }: ClaimServiceDeps) => {
  // Every claim change commits in one transaction, then tells clients which claim changed.
  const write = <T>(tenantId: string, id: string, work: (tx: Db) => Promise<Result<T>>) =>
    announced(announce, tenantId, db.transaction().execute(work), () => [{ kind: 'claim', id }]);
  const nudge = (tx: Db, tenantId: string, claimId: string) =>
    signalRuns(tx, boss, { tenantId, name: CLAIM_SIGNAL, key: claimId, payload: null });

  return {
    list: async (tenantId: string, filters: ClaimFilters) =>
      ok({ claims: await listClaims(db, tenantId, filters) }),

    find: async (tenantId: string, id: string) => {
      const claim = await findClaim(db, tenantId, id);
      if (!claim) return notFound;
      const events = await listClaimEvents(db, id);
      const progress =
        claim.status === 'open'
          ? nextClaimStep(
              {
                totalCents: claim.total_cents,
                coverages: claim.coverages.map((c) => ({ id: c.id, payer: c.payer })),
                events: events.map((e) => ({
                  kind: e.kind as ClaimEventKind,
                  coverageId: e.coverage_id,
                  paidCents: e.paid_cents,
                  adjustedCents: e.adjusted_cents,
                  at: new Date(e.created_at).toISOString()
                }))
              },
              now()
            )
          : null;
      return ok({ claim, events, progress });
    },

    setPayers: (tenantId: string, id: string, payers: string[]) =>
      write(tenantId, id, async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        if (claim.status !== 'open') return closed;
        const order = planPayerOrder(await listCoverages(tx, id), payers);
        const active = order.removed.find((c) => c.has_events);
        if (active) {
          return fail(
            'conflict',
            `${active.payer} already has billing activity on this claim, so it cannot be removed`
          );
        }
        await reorderCoverages(tx, tenantId, id, order);
        await nudge(tx, tenantId, id);
        return ok({ payers });
      }),

    document: async (tenantId: string, claimId: string, eventId: string) => {
      const found = await findEventDocument(db, tenantId, claimId, eventId);
      if (!found) return fail('not_found', 'Document not found');
      const ref = found.document as BlobRef;
      return ok({
        bytes: await blobs.getBytes(ref),
        contentType: ref.contentType,
        name: ref.key.split('/').at(-1) ?? 'document'
      });
    },

    saveBillingData: (tenantId: string, id: string, data: BillingData) =>
      write(tenantId, id, async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        if (claim.status !== 'open') return closed;
        const owned = new Set((await listCoverages(tx, id)).map((c) => c.id));
        if (data.coverages.some((c) => !owned.has(c.id))) {
          return fail('invalid', 'A coverage is not on this claim');
        }
        await saveBillingData(
          tx,
          tenantId,
          { id, patientId: claim.patient_id },
          {
            patient: data.patient,
            coverages: data.coverages,
            details: {
              serviceDate: data.serviceDate,
              pickup: data.pickup,
              destination: data.destination,
              diagnoses: data.diagnoses,
              originDestination: data.originDestination
            }
          }
        );
        return ok({ status: 'saved' });
      }),

    restartCycle: (tenantId: string, id: string) =>
      write(tenantId, id, async (tx) => {
        if (!(await lockClaim(tx, tenantId, id))) return notFound;
        const claim = await findClaim(tx, tenantId, id);
        if (!claim) return notFound;
        if (claim.status !== 'open') return closed;
        if (claim.cycle_status && LIVE_CYCLE.has(claim.cycle_status)) {
          return fail('conflict', 'The payer cycle for this claim is still active');
        }
        const [version] = await findPublishedGraphs(tx, tenantId, [CYCLE_WORKFLOW]);
        if (!version) return fail('not_found', 'The claim cycle workflow is not published');
        const runId = await startRun(tx, boss, {
          tenantId,
          versionId: version.id,
          inputs: { claimId: id }
        });
        await setCycleRun(tx, id, runId);
        return ok({ runId });
      }),

    recordResponse: (tenantId: string, userId: string, id: string, response: ClaimResponse) =>
      write(tenantId, id, async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        if (await hasResponse(tx, id, response.requestId)) {
          return ok({ balanceCents: await claimBalance(tx, id), duplicate: true });
        }
        if (claim.status !== 'open') return closed;
        if (
          response.coverageId !== null &&
          !(await listCoverages(tx, id)).some((c) => c.id === response.coverageId)
        ) {
          return fail('invalid', 'That payer is not on this claim');
        }
        const balance = await claimBalance(tx, id);
        const amount = response.paidCents + response.adjustedCents;
        if (amount > balance) {
          return fail(
            'invalid',
            `${dollars(amount)} is more than the remaining balance of ${dollars(balance)}`
          );
        }
        await insertResponse(tx, id, userId, response);
        const remaining = balance - amount;
        const moot = await resolveMootTasks(tx, tenantId, id, {
          coverageId: response.coverageId,
          settled: remaining <= 0
        });
        await enqueueRuns(
          boss,
          sqlExecutor(tx),
          moot.map((t) => resume(t.run_id, t.wait_id, { outcome: t.outcome, values: {}, userId }))
        );
        await nudge(tx, tenantId, id);
        return ok({ balanceCents: remaining, duplicate: false });
      })
  };
};

export type ClaimService = ReturnType<typeof createClaimService>;
