import { type Adjustment, CLAIM_SIGNAL, isClosedStatus } from '@ugula/billing';
import { enqueueRuns, type RunQueueClient, resume } from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';
import { sqlExecutor } from './client.ts';
import { fail, ok, type Result } from './result.ts';
import { signalRuns } from './runs.ts';
import type { Database } from './schema.ts';

type Db = Kysely<Database>;

export type CoverageRow = { id: string; payer: string; has_events: boolean };

export const payerName = sql<string>`coalesce(dp.name, cc.payer_name)`;

export const listCoverages = (db: Db, claimId: string): Promise<CoverageRow[]> =>
  db
    .selectFrom('claim_coverages as cc')
    .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
    .select((eb) => [
      'cc.id',
      payerName.as('payer'),
      sql<boolean>`exists (${eb
        .selectFrom('claim_events as e')
        .select('e.id')
        .whereRef('e.coverage_id', '=', 'cc.id')})`.as('has_events')
    ])
    .where('cc.claim_id', '=', claimId)
    .orderBy('cc.position')
    .execute();

export type ClaimResponse = {
  requestId: string;
  kind: 'response' | 'refunded';
  coverageId: string | null;
  paidCents: number;
  adjustedCents: number;
  paidOn: string | null;
  checkNumber: string | null;
  payerClaimNumber: string | null;
  adjustments: Adjustment[];
  note: string;
};

export const lockClaim = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('claims')
    .select(['id', 'status', 'patient_id'])
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();

export const claimBalance = async (db: Db, id: string) =>
  (
    await db
      .selectFrom('claim_balances')
      .select('balance_cents')
      .where('claim_id', '=', id)
      .executeTakeFirstOrThrow()
  ).balance_cents;

export const hasResponse = async (db: Db, claimId: string, requestId: string) =>
  (await db
    .selectFrom('claim_events')
    .select('id')
    .where('claim_id', '=', claimId)
    .where('source_key', '=', requestId)
    .executeTakeFirst()) !== undefined;

const FOLLOW_UP_QUEUE = 'billing-followup';

const COLLECTIONS_QUEUE = 'billing-collections';

export const resolveMootTasks = (
  db: Db,
  tenantId: string,
  claimId: string,
  moot: { coverageId: string | null; settled: boolean }
) =>
  db
    .updateTable('tasks')
    .set({
      status: 'completed',
      completed_at: sql`now()`,
      resolution: sql`jsonb_build_object('outcome', case when queue = ${FOLLOW_UP_QUEUE} then 'keepWaiting' else 'writeOff' end, 'values', '{}'::jsonb, 'resolvedBy', 'claim response')`,
      updated_at: sql`now()`
    })
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'open')
    .where(
      'run_id',
      'in',
      db.selectFrom('claim_runs').select('run_id').where('claim_id', '=', claimId)
    )
    .where((eb) =>
      eb.or([
        eb.and([
          eb('queue', '=', FOLLOW_UP_QUEUE),
          eb(sql<string>`context ->> 'coverageId'`, '=', moot.coverageId ?? '')
        ]),
        eb.and([eb('queue', '=', COLLECTIONS_QUEUE), eb.lit(moot.settled)])
      ])
    )
    .returning(['run_id', 'wait_id', sql<string>`resolution ->> 'outcome'`.as('outcome')])
    .execute();

export const insertResponse = async (
  db: Db,
  claimId: string,
  userId: string | null,
  r: ClaimResponse
) => {
  const event = await db
    .insertInto('claim_events')
    .values({
      claim_id: claimId,
      kind: r.kind,
      coverage_id: r.coverageId,
      paid_cents: r.kind === 'refunded' ? -r.paidCents : r.paidCents,
      adjusted_cents: r.adjustedCents,
      payer_claim_number: r.coverageId === null ? null : r.payerClaimNumber,
      paid_on: r.paidOn,
      check_number: r.checkNumber,
      note: r.note,
      created_by: userId,
      source_key: r.requestId
    })
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (event && r.adjustments.length) {
    await db
      .insertInto('claim_event_adjustments')
      .values(
        r.adjustments.map((a, i) => ({
          event_id: event.id,
          position: i + 1,
          group_code: a.group,
          reason_code: a.reason,
          amount_cents: a.cents
        }))
      )
      .execute();
  }
  return event !== undefined;
};

export const paidBy = async (db: Db, claimId: string, coverageId: string | null) =>
  (
    await db
      .selectFrom('claim_events')
      .select(sql<number>`coalesce(sum(paid_cents), 0)::int`.as('paid'))
      .where('claim_id', '=', claimId)
      .where((eb) =>
        coverageId === null ? eb('coverage_id', 'is', null) : eb('coverage_id', '=', coverageId)
      )
      .executeTakeFirstOrThrow()
  ).paid;

const notFound = fail('not_found', 'Claim not found');

const closed = fail('conflict', 'Claim is already closed');

const draft = fail(
  'conflict',
  'This claim is still a draft. Finish its PCR tasks before changing it.'
);

export const unchangeable = (status: string) =>
  isClosedStatus(status) ? closed : status === 'draft' ? draft : null;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const nudgeClaim = (tx: Db, boss: RunQueueClient, tenantId: string, claimId: string) =>
  signalRuns(tx, boss, { tenantId, name: CLAIM_SIGNAL, key: claimId, payload: null });

export const postClaimResponse = async (
  tx: Db,
  boss: RunQueueClient,
  tenantId: string,
  claimId: string,
  userId: string | null,
  response: ClaimResponse
): Promise<Result<{ balanceCents: number; duplicate: boolean }>> => {
  const claim = await lockClaim(tx, tenantId, claimId);
  if (!claim) return notFound;
  if (await hasResponse(tx, claimId, response.requestId)) {
    return ok({ balanceCents: await claimBalance(tx, claimId), duplicate: true });
  }
  const blocked = unchangeable(claim.status);
  if (blocked) return blocked;
  if (
    response.coverageId !== null &&
    !(await listCoverages(tx, claimId)).some((c) => c.id === response.coverageId)
  ) {
    return fail('invalid', 'That payer is not on this claim');
  }
  const balance = await claimBalance(tx, claimId);
  if (response.kind === 'refunded') {
    const paid = await paidBy(tx, claimId, response.coverageId);
    if (response.paidCents > paid) {
      return fail(
        'invalid',
        `${dollars(response.paidCents)} is more than the ${dollars(paid)} paid that can be refunded`
      );
    }
    await insertResponse(tx, claimId, userId, response);
    await nudgeClaim(tx, boss, tenantId, claimId);
    return ok({ balanceCents: balance + response.paidCents, duplicate: false });
  }
  const amount = response.paidCents + response.adjustedCents;
  if (amount > balance) {
    return fail(
      'invalid',
      `${dollars(amount)} is more than the remaining balance of ${dollars(balance)}`
    );
  }
  await insertResponse(tx, claimId, userId, response);
  const remaining = balance - amount;
  const moot = await resolveMootTasks(tx, tenantId, claimId, {
    coverageId: response.coverageId,
    settled: remaining <= 0
  });
  await enqueueRuns(
    boss,
    sqlExecutor(tx),
    moot.map((t) => resume(t.run_id, t.wait_id, { outcome: t.outcome, values: {}, userId }))
  );
  await nudgeClaim(tx, boss, tenantId, claimId);
  return ok({ balanceCents: remaining, duplicate: false });
};
