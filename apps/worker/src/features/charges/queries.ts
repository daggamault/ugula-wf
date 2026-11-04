import type { FeeStore } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

export const createFeeStore = (db: Kysely<Database>): FeeStore => ({
  findFees: async (runId, payerId, codes) => {
    if (!codes.length) return {};
    const rows = await db
      .selectFrom('fee_schedules')
      .distinctOn('code')
      .select(['code', 'amount_cents'])
      .where('agency_id', '=', runAgency(db, runId))
      .where('code', 'in', codes)
      .where((eb) =>
        payerId === null || !isUuid(payerId)
          ? eb('payer_id', 'is', null)
          : eb.or([eb('payer_id', 'is', null), eb('payer_id', '=', payerId)])
      )
      .orderBy('code')
      .orderBy('payer_id', (ob) => ob.asc().nullsLast())
      .execute();
    return Object.fromEntries(rows.map((r) => [r.code, r.amount_cents]));
  },
  saveFee: async (runId, payerId, code, unitCents) => {
    const payer = payerId === null ? null : isUuid(payerId) ? payerId : undefined;
    if (payer === undefined) throw new Error(`Payer ${payerId} is not in the directory`);
    const { numInsertedOrUpdatedRows } = await db
      .insertInto('fee_schedules')
      .columns(['agency_id', 'payer_id', 'code', 'amount_cents'])
      .expression(
        db
          .selectFrom('workflow_runs as r')
          .leftJoin('payers as p', (j) =>
            j.onRef('p.agency_id', '=', 'r.agency_id').on('p.id', '=', payer)
          )
          .select([
            'r.agency_id',
            'p.id',
            sql<string>`${code}::text`.as('code'),
            sql<number>`${unitCents}::int`.as('amount_cents')
          ])
          .where('r.id', '=', runId)
          .where((eb) => (payer === null ? eb.lit(true) : eb('p.id', 'is not', null)))
      )
      .onConflict((oc) =>
        oc.constraint('fee_schedules_agency_payer_code_unique').doUpdateSet({
          amount_cents: (eb) => eb.ref('excluded.amount_cents'),
          updated_at: sql`now()`
        })
      )
      .executeTakeFirst();
    if (!numInsertedOrUpdatedRows) throw new Error(`Payer ${payerId} is not in the directory`);
  }
});
