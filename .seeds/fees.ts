import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

export const demoFees: Record<string, number> = {
  A0425: 1_550,
  A0426: 70_000,
  A0427: 95_000,
  A0428: 60_000,
  A0429: 80_000,
  A0433: 120_000,
  A0434: 145_000,
  A0998: 25_000
};

export const buildUpsertDefaultFees = (
  db: Kysely<Database>,
  agencyId: string,
  fees: Record<string, number>
) =>
  db
    .insertInto('fee_schedules')
    .values(
      Object.entries(fees).map(([code, amount]) => ({
        agency_id: agencyId,
        payer_id: null,
        code,
        amount_cents: amount
      }))
    )
    .onConflict((oc) =>
      oc.columns(['agency_id', 'payer_id', 'code']).doUpdateSet({
        amount_cents: (eb) => eb.ref('excluded.amount_cents'),
        updated_at: sql`now()`
      })
    );
