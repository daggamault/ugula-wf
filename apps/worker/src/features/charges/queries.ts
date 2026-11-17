import type { FeeStore } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

export const createFeeStore = (db: Kysely<Database>): FeeStore => ({
  findSchedules: async (runId, payerId, codes) => {
    if (!codes.length) return { payer: {}, default: {} };
    const rows = await db
      .selectFrom('fee_schedules')
      .select(['code', 'payer_id', 'amount_cents'])
      .where('agency_id', '=', runAgency(db, runId))
      .where('code', 'in', codes)
      .where((eb) =>
        payerId === null || !isUuid(payerId)
          ? eb('payer_id', 'is', null)
          : eb.or([eb('payer_id', 'is', null), eb('payer_id', '=', payerId)])
      )
      .orderBy('code')
      .execute();
    const schedule = (payer: boolean) =>
      Object.fromEntries(
        rows.filter((r) => (r.payer_id !== null) === payer).map((r) => [r.code, r.amount_cents])
      );
    return { payer: schedule(true), default: schedule(false) };
  }
});
