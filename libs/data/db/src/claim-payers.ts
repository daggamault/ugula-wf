import { payerKey, SELF } from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';
import {
  type CoverageRow,
  listCoverages,
  lockClaim,
  nudgeClaim,
  unchangeable
} from './claim-responses.ts';
import { fail, ok, type Result } from './result.ts';
import type { Database } from './schema.ts';

type Db = Kysely<Database>;

export type PayerOrder = {
  keep: { id: string; position: number }[];
  add: { payer: string; position: number }[];
  remove: string[];
};

export const planPayerOrder = (
  existing: readonly CoverageRow[],
  names: readonly string[]
): PayerOrder & { removed: CoverageRow[] } => {
  const byName = new Map(existing.map((c) => [c.payer.toLowerCase(), c]));
  const keep: PayerOrder['keep'] = [];
  const add: PayerOrder['add'] = [];
  names.forEach((name, i) => {
    const found = byName.get(name.toLowerCase());
    if (found) keep.push({ id: found.id, position: i + 1 });
    else add.push({ payer: name, position: i + 1 });
  });
  const kept = new Set(keep.map((c) => c.id));
  const removed = existing.filter((c) => !kept.has(c.id));
  return { keep, add, remove: removed.map((c) => c.id), removed };
};

export const reorderCoverages = async (
  db: Db,
  agencyId: string,
  claimId: string,
  order: PayerOrder
) => {
  if (order.remove.length) {
    await db
      .deleteFrom('claim_coverages')
      .where('claim_id', '=', claimId)
      .where('id', 'in', order.remove)
      .execute();
  }
  if (order.keep.length) {
    await sql`
      update claim_coverages cc set position = v.position
      from (values ${sql.join(order.keep.map((c) => sql`(${c.id}::uuid, ${c.position}::smallint)`))})
        as v (id, position)
      where cc.id = v.id and cc.claim_id = ${claimId}`.execute(db);
  }
  if (order.add.length) {
    await db
      .insertInto('claim_coverages')
      .values(
        order.add.map((c) => ({
          claim_id: claimId,
          agency_id: agencyId,
          position: c.position,
          payer_name: c.payer,
          relationship: SELF,
          payer_id: db
            .selectFrom('payers')
            .select('id')
            .where('agency_id', '=', agencyId)
            .where((eb) =>
              eb.or([
                eb(sql`lower(name)`, '=', c.payer.toLowerCase()),
                eb(
                  'id',
                  'in',
                  eb
                    .selectFrom('payer_aliases')
                    .select('payer_id')
                    .where('agency_id', '=', agencyId)
                    .where('alias_key', '=', payerKey(c.payer))
                )
              ])
            )
            .orderBy(sql`lower(name) = ${c.payer.toLowerCase()}`, 'desc')
            .limit(1)
        }))
      )
      .execute();
  }
  await db
    .updateTable('claims')
    .set({ updated_at: sql`now()` })
    .where('id', '=', claimId)
    .execute();
};

export const setClaimPayers = async (
  tx: Db,
  boss: RunQueueClient,
  agencyId: string,
  claimId: string,
  names: readonly string[]
): Promise<Result<{ payers: string[] }>> => {
  const claim = await lockClaim(tx, agencyId, claimId);
  if (!claim) return fail('not_found', 'Claim not found');
  const blocked = unchangeable(claim.status);
  if (blocked) return blocked;
  const order = planPayerOrder(await listCoverages(tx, claimId), names);
  const active = order.removed.find((c) => c.has_events);
  if (active) {
    return fail(
      'conflict',
      `${active.payer} already has billing activity on this claim, so it cannot be removed`
    );
  }
  await reorderCoverages(tx, agencyId, claimId, order);
  await nudgeClaim(tx, boss, agencyId, claimId);
  return ok({ payers: [...names] });
};
