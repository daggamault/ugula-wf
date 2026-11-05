import { ACTIVE_RUN_STATUSES, type Db } from '@ugula/db';
import { sql } from 'kysely';

export const hasActiveRun = async (db: Db, claimId: string) =>
  (await db
    .selectFrom('claim_runs as cr')
    .innerJoin('workflow_runs as r', 'r.id', 'cr.run_id')
    .select('r.id')
    .where('cr.claim_id', '=', claimId)
    .where('r.status', 'in', ACTIVE_RUN_STATUSES)
    .limit(1)
    .executeTakeFirst()) !== undefined;

export const setCycleRun = async (db: Db, id: string, runId: string) => {
  await db.insertInto('claim_runs').values({ run_id: runId, claim_id: id }).execute();
  await db
    .updateTable('claims')
    .set({ cycle_run_id: runId, updated_at: sql`now()` })
    .where('id', '=', id)
    .execute();
};
