import {
  CLOSED_CLAIM_STATUSES,
  type ClaimStatus,
  type ClaimStore,
  claimSignalKey,
  isClosedStatus
} from '@ugula/billing';
import {
  ACTIVE_RUN_STATUSES,
  applyClaimEdit,
  type Db,
  findClaimCheck,
  sqlExecutor,
  TERMINAL_RUN_STATUSES
} from '@ugula/db';
import { cancel, enqueueRuns, type RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';
import { agencyClaim, linkClaimRun, signalClaim } from './claim-scope.ts';

const DRAFT: ClaimStatus = 'draft';

const REVIEWABLE: ClaimStatus = 'needs_review';

export const otherClaimRuns = (runId: string, claimId: string) =>
  sql<{ id: string }>`
    with recursive closing (id, parent_id) as (
      select id, parent_id from workflow_runs where id = ${runId}
      union all
      select r.id, r.parent_id from workflow_runs r join closing c on r.id = c.parent_id
    )
    select r.id from workflow_runs r
    where r.status in (${sql.join(ACTIVE_RUN_STATUSES)})
      and r.id not in (select id from closing)
      and (
        r.id in (select cr.run_id from claim_runs cr where cr.claim_id = ${claimId})
        or r.id = (select cycle_run_id from claims where id = ${claimId})
      )`;

export const createCycleStore = (
  db: Db,
  boss: RunQueueClient
): Pick<
  ClaimStore,
  'claimCheck' | 'patchClaim' | 'setStatus' | 'attachCycle' | 'closeClaim' | 'linkRun'
> => ({
  claimCheck: async (runId, claimId) => {
    if (!isUuid(claimId)) return null;
    const run = await runAgency(db, runId).executeTakeFirst();
    return run ? findClaimCheck(db, run.agency_id, claimId) : null;
  },

  patchClaim: (runId, claimId, sourceKey, { coverage, ...patch }) =>
    db.transaction().execute(async (tx) => {
      const claim = await agencyClaim(tx, runId, claimId);
      const edited = await applyClaimEdit(
        tx,
        claim.agency_id,
        claim.id,
        { ...patch, coverages: coverage ? [{ ...coverage, groupId: null }] : [] },
        { sourceKey, createdBy: null }
      );
      if (edited) await signalClaim(tx, boss, claim.agency_id, claim.id);
    }),

  setStatus: async (runId, claimId, _sourceKey, status, signalsSeen) => {
    const claim = await agencyClaim(db, runId, claimId);
    const { rows } = await sql<{ received: number }>`
      with current as (
        select coalesce(max(received), 0) as received from signals
        where agency_id = ${claim.agency_id} and key = ${claimSignalKey(claim.id)}
      ), changed as (
        update claims set status = ${status}, updated_at = now()
        where id = ${claim.id}
          and status <> ${status}
          and status not in (${sql.join(['draft', ...CLOSED_CLAIM_STATUSES])})
          and (select received from current) = ${signalsSeen}
        returning id
      )
      select received from current`.execute(db);
    return Number(rows[0]?.received ?? 0) === signalsSeen ? 'set' : 'stale';
  },

  attachCycle: async (runId, claimId, _sourceKey, cycleRunId) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const cycle = isUuid(cycleRunId)
        ? await tx
            .selectFrom('workflow_runs')
            .select('id')
            .where('id', '=', cycleRunId)
            .where('agency_id', '=', claim.agency_id)
            .executeTakeFirst()
        : undefined;
      if (!cycle) throw new Error(`Run ${cycleRunId} does not exist`);
      const { numUpdatedRows } = await tx
        .updateTable('claims as c')
        .set({
          cycle_run_id: cycle.id,
          status: sql`case when c.status = ${DRAFT} then ${REVIEWABLE} else c.status end`,
          updated_at: sql`now()`
        })
        .where('c.id', '=', claim.id)
        .where((eb) =>
          eb.or([
            eb('c.cycle_run_id', 'is', null),
            eb('c.cycle_run_id', '=', cycle.id),
            eb.not(
              eb.exists(
                eb
                  .selectFrom('workflow_runs as r')
                  .select('r.id')
                  .whereRef('r.id', '=', 'c.cycle_run_id')
                  .where('r.status', 'not in', TERMINAL_RUN_STATUSES)
              )
            )
          ])
        )
        .executeTakeFirst();
      if (!numUpdatedRows) throw new Error(`Claim ${claimId} already has an active payer cycle`);
      await linkClaimRun(tx, cycle.id, claim.id);
      await signalClaim(tx, boss, claim.agency_id, claim.id);
    });
  },

  closeClaim: async (runId, claimId, sourceKey, requested) => {
    const claim = await agencyClaim(db, runId, claimId);
    await db.transaction().execute(async (tx) => {
      const locked = await tx
        .selectFrom('claims')
        .select('status')
        .where('id', '=', claim.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (isClosedStatus(locked.status)) return;
      const { balance_cents } = await tx
        .selectFrom('claim_balances')
        .select('balance_cents')
        .where('claim_id', '=', claim.id)
        .executeTakeFirstOrThrow();
      const status = requested !== 'void' && balance_cents <= 0 ? 'paid' : requested;
      await tx
        .updateTable('claims')
        .set({ status, updated_at: sql`now()` })
        .where('id', '=', claim.id)
        .execute();
      await tx
        .insertInto('claim_events')
        .values({ claim_id: claim.id, kind: 'closed', note: status, source_key: sourceKey })
        .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
        .execute();
      await tx
        .deleteFrom('signals')
        .where('agency_id', '=', claim.agency_id)
        .where('key', '=', claimSignalKey(claim.id))
        .execute();
      const { rows } = await otherClaimRuns(runId, claim.id).execute(tx);
      await enqueueRuns(
        boss,
        sqlExecutor(tx),
        rows.map((r) => cancel(r.id))
      );
    });
  },

  linkRun: async (runId, claimId) => {
    const claim = await agencyClaim(db, runId, claimId);
    await linkClaimRun(db, runId, claim.id);
  }
});
