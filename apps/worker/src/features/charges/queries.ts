import type { FeeStore } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

export const createFeeStore = (db: Kysely<Database>): FeeStore => ({
  findFee: async (runId, payerId, code) => {
    if (payerId !== null && !isUuid(payerId)) throw new Error(`Payer ${payerId} does not exist`);
    const row = await db
      .selectFrom('fee_schedules')
      .select('amount_cents')
      .where('agency_id', '=', runAgency(db, runId))
      .where('code', '=', code)
      .where((eb) =>
        payerId === null
          ? eb('payer_id', 'is', null)
          : eb.or([eb('payer_id', 'is', null), eb('payer_id', '=', payerId)])
      )
      .orderBy(sql`payer_id is null`)
      .limit(1)
      .executeTakeFirst();
    return row?.amount_cents ?? null;
  }
});
