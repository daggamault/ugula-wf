import type { FeeStore } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import { runTenant } from '../../shared/tenancy.ts';

export const createFeeStore = (db: Kysely<Database>): FeeStore => ({
  findFees: async (runId, payerId, codes) => {
    if (!codes.length) return {};
    const rows = await db
      .selectFrom('fee_schedules')
      .distinctOn('code')
      .select(['code', 'amount_cents'])
      .where('tenant_id', '=', runTenant(db, runId))
      .where('code', 'in', codes)
      .where((eb) =>
        payerId === null
          ? eb('payer_id', 'is', null)
          : eb.or([eb('payer_id', 'is', null), eb('payer_id', '=', payerId)])
      )
      .orderBy('code')
      .orderBy('payer_id', (ob) => ob.asc().nullsLast())
      .execute();
    return Object.fromEntries(rows.map((r) => [r.code, r.amount_cents]));
  }
});
