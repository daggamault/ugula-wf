import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { FeeInput, FeeSort } from './schemas.ts';

type Db = Kysely<Database>;

export type FeeFilters = PageRequest<FeeSort> & { q?: string | undefined };

const feeRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('fee_schedules as f')
    .leftJoin('payers as p', 'p.id', 'f.payer_id')
    .select(['f.id', 'f.payer_id', 'p.name as payer', 'f.code', 'f.amount_cents', 'f.updated_at'])
    .where('f.tenant_id', '=', tenantId);

const FEE_ORDER = {
  payer: sql`(p.name is not null, lower(p.name), f.code)`,
  code: sql.ref('f.code'),
  amount: sql.ref('f.amount_cents'),
  updated: sql.ref('f.updated_at')
};

export const searchFees = (db: Db, tenantId: string, f: FeeFilters) => {
  let q = feeRows(db, tenantId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(f.code)`, 'like', like),
        eb(sql`lower(coalesce(p.name, 'Default'))`, 'like', like)
      ])
    );
  }
  return paged(q, f, FEE_ORDER, sql.ref('f.id'));
};

export const findFee = (db: Db, tenantId: string, id: string) =>
  feeRows(db, tenantId).where('f.id', '=', id).executeTakeFirst();

export const payerExists = async (db: Db, tenantId: string, id: string) =>
  (await db
    .selectFrom('payers')
    .select('id')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst()) !== undefined;

export const upsertFee = (db: Db, tenantId: string, fee: FeeInput) =>
  db
    .with('saved', (w) =>
      w
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
        .returning(['id', 'payer_id', 'code', 'amount_cents', 'updated_at'])
    )
    .selectFrom('saved as f')
    .leftJoin('payers as p', 'p.id', 'f.payer_id')
    .select(['f.id', 'f.payer_id', 'p.name as payer', 'f.code', 'f.amount_cents', 'f.updated_at'])
    .executeTakeFirstOrThrow();

export const deleteFee = async (db: Db, tenantId: string, id: string) =>
  (await db
    .deleteFrom('fee_schedules')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;
