import { claimSignalKey } from '@ugula/billing';
import { type Db, sqlExecutor } from '@ugula/db';
import { enqueueRuns, type RunQueueClient, resume } from '@ugula/run-queue';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

export const agencyClaim = async (db: Db, runId: string, claimId: string) =>
  (isUuid(claimId)
    ? await db
        .selectFrom('claims')
        .select(['id', 'agency_id'])
        .where('id', '=', claimId)
        .where('agency_id', '=', runAgency(db, runId))
        .executeTakeFirst()
    : undefined) ?? Promise.reject(new Error(`Claim ${claimId} does not exist`));

export const linkClaimRun = (db: Db, runId: string, claimId: string) =>
  db
    .insertInto('claim_runs')
    .columns(['run_id', 'claim_id'])
    .expression(
      db
        .selectFrom('workflow_runs')
        .select(['id', sql<string>`${claimId}::uuid`.as('claim_id')])
        .where('id', '=', runId)
        .where(
          'agency_id',
          '=',
          db.selectFrom('claims').select('agency_id').where('id', '=', claimId)
        )
    )
    .onConflict((oc) => oc.column('run_id').doNothing())
    .execute();

export const signalClaim = async (
  tx: Db,
  boss: RunQueueClient,
  agencyId: string,
  claimId: string
) => {
  const key = claimSignalKey(claimId);
  await tx
    .insertInto('signals')
    .values({ agency_id: agencyId, key, received: 1 })
    .onConflict((oc) =>
      oc
        .columns(['agency_id', 'key'])
        .doUpdateSet({ received: sql`signals.received + 1`, updated_at: sql`now()` })
    )
    .execute();
  const waiting = await tx
    .selectFrom('workflow_runs')
    .select(['id', sql<string>`state -> 'suspension' ->> 'id'`.as('wait_id')])
    .where('agency_id', '=', agencyId)
    .where('wait_key', '=', key)
    .where('status', '=', 'suspended')
    .execute();
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    waiting.map((r) => resume(r.id, r.wait_id, { payload: null }))
  );
};

export const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;
