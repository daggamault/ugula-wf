import { CLAIM_SIGNAL, claimIssues, isClosedStatus, nextClaimStep } from '@ugula/billing';
import {
  applyClaimEdit,
  type ClaimEdit,
  type Db,
  findClaimCheck,
  findPublishedGraphs,
  sqlExecutor
} from '@ugula/db';
import { enqueueRuns, type RunQueueClient, resume } from '@ugula/run-queue';
import type { BlobRef, BlobStore } from '@ugula/storage';
import { listLedgerEvents } from '../../shared/ledger.ts';
import { type Announce, announced } from '../../shared/live.ts';
import type { PageRequest } from '../../shared/paging.ts';
import { fail, ok, type Result } from '../../shared/result.ts';
import { signalRuns, startRun } from '../../shared/runs.ts';
import {
  type ClaimFilters,
  type CoverageRow,
  claimBalance,
  claimExists,
  findClaim,
  findEventDocument,
  hasActiveRun,
  hasResponse,
  insertResponse,
  listClaimEvents,
  listClaimFiles,
  listClaims,
  listCoverages,
  lockClaim,
  type PayerOrder,
  paidBy,
  reorderCoverages,
  resolveMootTasks,
  setCycleRun
} from './queries.ts';
import type { BillingData, ClaimEventSort, ClaimResponse, PayerEntry } from './schemas.ts';

type ClaimServiceDeps = {
  db: Db;
  boss: RunQueueClient;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes'>;
  announce: Announce;
};

const CYCLE_WORKFLOW = { key: 'billing.cycle-claim', version: 1 };

const notFound = fail('not_found', 'Claim not found');
const closed = fail('conflict', 'Claim is already closed');
const draft = fail(
  'conflict',
  'This claim is still a draft. Finish its PCR tasks before changing it.'
);

const unchangeable = (status: string) =>
  isClosedStatus(status) ? closed : status === 'draft' ? draft : null;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const planPayerOrder = (
  existing: readonly CoverageRow[],
  payers: readonly PayerEntry[]
): PayerOrder & { removed: CoverageRow[] } => {
  const byName = new Map(existing.map((c) => [c.payer.toLowerCase(), c]));
  const keep: PayerOrder['keep'] = [];
  const add: PayerOrder['add'] = [];
  payers.forEach(({ name, ...insured }, i) => {
    const found = byName.get(name.toLowerCase());
    if (found) keep.push({ id: found.id, position: i + 1 });
    else add.push({ payer: name, position: i + 1, ...insured });
  });
  const kept = new Set(keep.map((c) => c.id));
  const removed = existing.filter((c) => !kept.has(c.id));
  return { keep, add, remove: removed.map((c) => c.id), removed };
};

export const claimEdit = (data: BillingData): ClaimEdit => ({
  serviceDate: data.serviceDate,
  tripType: null,
  level: null,
  emergency: null,
  loadedMiles: null,
  diagnoses: data.diagnoses,
  pickup: data.pickup,
  destination: data.destination,
  originDestination: data.originDestination,
  patientAddress: data.patient,
  coverages: data.coverages.map((c) => ({
    coverageId: c.id,
    payerId: null,
    memberId: c.memberId,
    groupId: c.groupId,
    relationship: c.relationship,
    insuredFirstName: c.insuredFirstName,
    insuredLastName: c.insuredLastName,
    remove: c.remove
  })),
  newCoverage: null,
  lines: null,
  note: data.note
});

export const createClaimService = ({ db, boss, now, blobs, announce }: ClaimServiceDeps) => {
  const write = <T>(tenantId: string, id: string, work: (tx: Db) => Promise<Result<T>>) =>
    announced(announce, tenantId, db.transaction().execute(work), () => [{ kind: 'claim', id }]);
  const nudge = (tx: Db, tenantId: string, claimId: string) =>
    signalRuns(tx, boss, { tenantId, name: CLAIM_SIGNAL, key: claimId, payload: null });

  return {
    list: async (tenantId: string, filters: ClaimFilters) =>
      ok(await listClaims(db, tenantId, filters)),

    find: async (tenantId: string, id: string) => {
      const claim = await findClaim(db, tenantId, id);
      if (!claim) return notFound;
      const open = unchangeable(claim.status) === null;
      const [files, events, check] = await Promise.all([
        listClaimFiles(db, id),
        open ? listLedgerEvents(db, id) : [],
        findClaimCheck(db, tenantId, id)
      ]);
      const progress = open
        ? nextClaimStep(
            {
              totalCents: claim.total_cents,
              coverages: claim.coverages.map((c) => ({ id: c.id, payer: c.payer })),
              events
            },
            now()
          )
        : null;
      return ok({ claim, files, progress, issues: check ? claimIssues(check) : [] });
    },

    events: async (tenantId: string, id: string, page: PageRequest<ClaimEventSort>) =>
      (await claimExists(db, tenantId, id)) ? ok(await listClaimEvents(db, id, page)) : notFound,

    setPayers: (tenantId: string, id: string, payers: PayerEntry[]) =>
      write(tenantId, id, async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
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
        return ok({ payers: payers.map((p) => p.name) });
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

    saveBillingData: (tenantId: string, userId: string, id: string, data: BillingData) =>
      write(tenantId, id, async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        const coverages = new Map((await listCoverages(tx, id)).map((c) => [c.id, c]));
        if (data.coverages.some((c) => !coverages.has(c.id))) {
          return fail('invalid', 'A coverage is not on this claim');
        }
        const active = data.coverages.find((c) => c.remove && coverages.get(c.id)?.has_events);
        if (active) {
          return fail(
            'conflict',
            `${coverages.get(active.id)?.payer} already has billing activity on this claim, so it cannot be removed`
          );
        }
        await applyClaimEdit(tx, tenantId, id, claimEdit(data), {
          sourceKey: null,
          createdBy: userId
        });
        await nudge(tx, tenantId, id);
        return ok({ status: 'saved' });
      }),

    restartCycle: (tenantId: string, id: string) =>
      write(tenantId, id, async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        if (await hasActiveRun(tx, id)) {
          return fail('conflict', 'This claim still has an active workflow run');
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
        const blocked = unchangeable(claim.status);
        if (blocked) return blocked;
        if (
          response.coverageId !== null &&
          !(await listCoverages(tx, id)).some((c) => c.id === response.coverageId)
        ) {
          return fail('invalid', 'That payer is not on this claim');
        }
        const balance = await claimBalance(tx, id);
        if (response.kind === 'refunded') {
          const paid = await paidBy(tx, id, response.coverageId);
          if (response.paidCents > paid) {
            return fail(
              'invalid',
              `${dollars(response.paidCents)} is more than the ${dollars(paid)} paid that can be refunded`
            );
          }
          await insertResponse(tx, id, userId, response);
          await nudge(tx, tenantId, id);
          return ok({ balanceCents: balance + response.paidCents, duplicate: false });
        }
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
