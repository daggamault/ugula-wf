import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import type { FeeInput } from './schemas.ts';

type Db = Kysely<Database>;

const feeRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('fee_schedules as f')
    .leftJoin('payers as p', 'p.id', 'f.payer_id')
    .select(['f.id', 'f.payer_id', 'p.name as payer', 'f.code', 'f.amount_cents', 'f.updated_at'])
    .where('f.tenant_id', '=', tenantId);

export const listFees = (db: Db, tenantId: string) =>
  feeRows(db, tenantId)
    .orderBy(sql`lower(p.name)`, (ob) => ob.asc().nullsFirst())
    .orderBy('f.code')
    .execute();

export const payerExists = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('payers')
    .select('id')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst()) !== undefined;

export const upsertFee = async (db: Db, tenantId: string, fee: FeeInput) => {
  const { id } = await db
    .insertInto('fee_schedules')
    .values({
      tenant_id: tenantId,
      payer_id: fee.payerId,
      code: fee.code,
      amount_cents: fee.amountCents
    })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'payer_id', 'code'])
        .doUpdateSet({ amount_cents: fee.amountCents, updated_at: sql`now()` })
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return feeRows(db, tenantId).where('f.id', '=', id).executeTakeFirstOrThrow();
};

export const deleteFee = async (db: Db, tenantId: string, id: string) =>
  (await db
    .deleteFrom('fee_schedules')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;
