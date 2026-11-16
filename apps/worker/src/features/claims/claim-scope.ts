import type { Db } from '@ugula/db';
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
    .columns(['agency_id', 'run_id', 'claim_id'])
    .expression(
      db
        .selectFrom('workflow_runs')
        .select(['agency_id', 'id', sql<string>`${claimId}::uuid`.as('claim_id')])
        .where('id', '=', runId)
        .where(
          'agency_id',
          '=',
          db.selectFrom('claims').select('agency_id').where('id', '=', claimId)
        )
    )
    .onConflict((oc) => oc.column('run_id').doNothing())
    .execute();

export const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;
