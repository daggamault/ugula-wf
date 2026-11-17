import type { RunQueueClient } from '@ugula/run-queue';
import { sql } from 'kysely';
import { lockClaim, unchangeable } from './claim-responses.ts';
import { findPublishedGraphs } from './graph-versions.ts';
import { fail, ok, type Result } from './result.ts';
import { startRun } from './runs.ts';
import { ACTIVE_RUN_STATUSES, type Db } from './schema.ts';

export const CYCLE_WORKFLOW = { key: 'billing.cycle-claim', version: 1 };

export const hasActiveRun = async (db: Db, claimId: string, exceptRunId: string | null = null) => {
  const active = db
    .selectFrom('claim_runs as cr')
    .innerJoin('workflow_runs as r', 'r.id', 'cr.run_id')
    .select('r.id')
    .where('cr.claim_id', '=', claimId)
    .where('r.status', 'in', ACTIVE_RUN_STATUSES);
  const other = exceptRunId === null ? active : active.where('r.id', '<>', exceptRunId);
  return (await other.limit(1).executeTakeFirst()) !== undefined;
};

export const setCycleRun = async (db: Db, agencyId: string, id: string, runId: string) => {
  await db
    .insertInto('claim_runs')
    .values({ agency_id: agencyId, run_id: runId, claim_id: id })
    .execute();
  await db
    .updateTable('claims')
    .set({ cycle_run_id: runId, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute();
};

export type CycleRestart = {
  agencyId: string;
  claimId: string;
  exceptRunId?: string | null;
  interactive?: boolean;
};

export const restartCycle = async (
  tx: Db,
  boss: RunQueueClient,
  { agencyId, claimId, exceptRunId = null, interactive = false }: CycleRestart
): Promise<Result<{ runId: string }>> => {
  const claim = await lockClaim(tx, agencyId, claimId);
  if (!claim) return fail('not_found', 'Claim not found');
  const blocked = unchangeable(claim.status);
  if (blocked) return blocked;
  if (await hasActiveRun(tx, claimId, exceptRunId)) {
    return fail('conflict', 'This claim still has an active workflow run');
  }
  const [version] = await findPublishedGraphs(tx, agencyId, [CYCLE_WORKFLOW]);
  if (!version) return fail('not_found', 'The claim cycle workflow is not published');
  const runId = await startRun(tx, boss, {
    agencyId,
    versionId: version.id,
    inputs: { claimId },
    interactive
  });
  await setCycleRun(tx, agencyId, claimId, runId);
  return ok({ runId });
};
