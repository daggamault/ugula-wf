import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import type { FeeInput } from './schemas.ts';

type Db = Kysely<Database>;

const columns = ['id', 'payer', 'code', 'amount_cents', 'updated_at'] as const;

export const listFees = (db: Db, tenantId: string) =>
  db
    .selectFrom('fee_schedules')
    .select(columns)
    .where('tenant_id', '=', tenantId)
    .orderBy('payer', (ob) => ob.asc().nullsFirst())
    .orderBy('code')
    .execute();

export const upsertFee = (db: Db, tenantId: string, fee: FeeInput) =>
  db
    .insertInto('fee_schedules')
    .values({
      tenant_id: tenantId,
      payer: fee.payer,
      code: fee.code,
      amount_cents: fee.amountCents
    })
    .onConflict((oc) =>
      oc
        .expression(sql`tenant_id, lower(coalesce(payer, '')), code`)
        .doUpdateSet({ amount_cents: fee.amountCents, updated_at: sql`now()` })
    )
    .returning(columns)
    .executeTakeFirstOrThrow();

export const deleteFee = async (db: Db, tenantId: string, id: string) =>
  (await db
    .deleteFrom('fee_schedules')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;
