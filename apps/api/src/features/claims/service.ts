import { type ClaimEventKind, nextClaimStep } from '@ugula/billing';
import type { BlobRef, BlobStore } from '@ugula/blobs';
import { type Db, findPublishedGraphs, sqlExecutor } from '@ugula/db';
import { enqueueRuns, type JobBoss, resume } from '@ugula/jobs';
import { fail, ok } from '../../shared/result.ts';
import { signalRuns, startRun } from '../../shared/runs.ts';
import {
  type ClaimFilters,
  type ClaimResponse,
  claimBalance,
  findClaim,
  findEventDocument,
  hasResponse,
  insertResponse,
  listClaimEvents,
  listClaims,
  lockClaim,
  resolveMootTasks,
  saveBillingData,
  setCycleRun,
  updatePayers
} from './queries.ts';
import type { BillingData } from './schemas.ts';

export type ClaimServiceDeps = {
  db: Db;
  boss: JobBoss;
  now: () => Date;
  blobs: Pick<BlobStore, 'getBytes'>;
};

const CYCLE_WORKFLOW = { key: 'billing.cycle-claim', version: 1 };

const LIVE_CYCLE = new Set(['running', 'suspended', 'faulted']);

const notFound = fail('not_found', 'Claim not found');
const closed = fail('conflict', 'Claim is already closed');

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const createClaimService = ({ db, boss, now, blobs }: ClaimServiceDeps) => {
  const nudge = (tx: Db, tenantId: string, claimId: string) =>
    signalRuns(tx, boss, { tenantId, name: 'claim', key: claimId, payload: null });

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
                payers: claim.payers,
                events: events.map((e) => ({
                  kind: e.kind as ClaimEventKind,
                  payer: e.payer,
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
      db.transaction().execute(async (tx) => {
        if (!(await updatePayers(tx, tenantId, id, payers))) {
          return (await findClaim(tx, tenantId, id)) ? closed : notFound;
        }
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
      db.transaction().execute(async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        if (claim.status !== 'open') return closed;
        const unknown = data.coverages.find((c) => !claim.payers.includes(c.payer));
        if (unknown) return fail('invalid', `${unknown.payer} is not a payer on this claim`);
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
              diagnoses: [...new Set(data.diagnoses)],
              originDestination: data.originDestination
            }
          }
        );
        return ok({ status: 'saved' });
      }),

    restartCycle: (tenantId: string, id: string) =>
      db.transaction().execute(async (tx) => {
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
      db.transaction().execute(async (tx) => {
        const claim = await lockClaim(tx, tenantId, id);
        if (!claim) return notFound;
        if (await hasResponse(tx, id, response.requestId)) {
          return ok({ balanceCents: await claimBalance(tx, id), duplicate: true });
        }
        if (claim.status !== 'open') return closed;
        if (response.payer !== null && !claim.payers.includes(response.payer)) {
          return fail('invalid', `${response.payer} is not a payer on this claim`);
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
          payer: response.payer,
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
