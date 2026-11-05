import type { Database, Db } from '@ugula/db';
import { type QueryCreator, sql } from 'kysely';
import type { Writes } from '../../shared/access.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { FeeInput, FeeSort } from './schemas.ts';

export type FeeFilters = PageRequest<FeeSort> & { q?: string | undefined };

const feeRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('fee_schedules as f')
    .leftJoin('payers as p', 'p.id', 'f.payer_id')
    .select(['f.id', 'f.payer_id', 'p.name as payer', 'f.code', 'f.amount_cents', 'f.updated_at'])
    .where('f.agency_id', '=', agencyId);

const FEE_ORDER = {
  payer: sql`(p.name is not null, lower(p.name), f.code)`,
  code: sql.ref('f.code'),
  amount: sql.ref('f.amount_cents'),
  updated: sql.ref('f.updated_at')
};

export const searchFees = (db: Db, agencyId: string, f: FeeFilters) => {
  let q = feeRows(db, agencyId);
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

export const findFee = (db: Db, agencyId: string, id: string) =>
  feeRows(db, agencyId).where('f.id', '=', id).executeTakeFirst();

export const payerExists = async (db: Db, agencyId: string, id: string) =>
  (await db
    .selectFrom('payers')
    .select('id')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .executeTakeFirst()) !== undefined;

const SAVED = ['id', 'payer_id', 'code', 'amount_cents', 'updated_at'] as const;

const insertFee = (db: QueryCreator<Database>, agencyId: string, fee: FeeInput, update: boolean) =>
  db
    .insertInto('fee_schedules')
    .values({
      agency_id: agencyId,
      payer_id: fee.payerId,
      code: fee.code,
      amount_cents: fee.amountCents
    })
    .onConflict((oc) => {
      const key = oc.columns(['agency_id', 'payer_id', 'code']);
      return update
        ? key.doUpdateSet({ amount_cents: fee.amountCents, updated_at: sql`now()` })
        : key.doNothing();
    })
    .returning(SAVED);

const updateFee = (db: QueryCreator<Database>, agencyId: string, fee: FeeInput) =>
  db
    .updateTable('fee_schedules')
    .set({ amount_cents: fee.amountCents, updated_at: sql`now()` })
    .where('agency_id', '=', agencyId)
    .where(sql<boolean>`payer_id is not distinct from ${fee.payerId}`)
    .where('code', '=', fee.code)
    .returning(SAVED);

export const saveFee = (db: Db, agencyId: string, fee: FeeInput, writes: Writes) =>
  db
    .with('saved', (w) =>
      writes.create ? insertFee(w, agencyId, fee, writes.update) : updateFee(w, agencyId, fee)
    )
    .selectFrom('saved as f')
    .leftJoin('payers as p', 'p.id', 'f.payer_id')
    .select(['f.id', 'f.payer_id', 'p.name as payer', 'f.code', 'f.amount_cents', 'f.updated_at'])
    .executeTakeFirst();

export const deleteFee = async (db: Db, agencyId: string, id: string) =>
  (await db
    .deleteFrom('fee_schedules')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .returning('id')
    .executeTakeFirst()) !== undefined;
