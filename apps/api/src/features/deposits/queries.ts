import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { DepositInput, DepositSort } from './schemas.ts';

export type DepositFilters = PageRequest<DepositSort> & { q?: string | undefined };

const ORDER = {
  deposited: sql.ref('d.deposited_on'),
  amount: sql.ref('d.amount_cents'),
  trace: sql`lower(d.trace_number)`
};

const depositRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('deposits as d')
    .leftJoin('payer_files as f', 'f.id', 'd.payer_file_id')
    .leftJoin('users as u', 'u.id', 'd.created_by_id')
    .select([
      'd.id',
      'd.trace_number',
      'd.amount_cents',
      'd.deposited_on',
      'd.payer_name',
      'd.note',
      'd.payer_file_id',
      'f.file_name',
      'f.payment_cents',
      'f.paid_on',
      'u.email as created_by',
      'd.created_at'
    ])
    .where('d.agency_id', '=', agencyId);

export const searchDeposits = (db: Db, agencyId: string, f: DepositFilters) => {
  if (!f.q) return paged(depositRows(db, agencyId), f, ORDER, sql.ref('d.id'));
  const pattern = containsPattern(f.q);
  return paged(
    depositRows(db, agencyId).where((eb) =>
      eb.or([
        eb(sql`lower(d.trace_number)`, 'like', pattern),
        eb(sql`lower(d.payer_name)`, 'like', pattern)
      ])
    ),
    f,
    ORDER,
    sql.ref('d.id')
  );
};

export const findDeposit = (db: Db, agencyId: string, id: string) =>
  depositRows(db, agencyId).where('d.id', '=', id).executeTakeFirst();

export const insertDeposit = (db: Db, agencyId: string, userId: string, d: DepositInput) =>
  db
    .insertInto('deposits')
    .values({
      agency_id: agencyId,
      trace_number: d.traceNumber,
      amount_cents: d.amountCents,
      deposited_on: d.depositedOn,
      payer_name: d.payerName,
      note: d.note,
      created_by_id: userId
    })
    .onConflict((oc) => oc.columns(['agency_id', 'trace_number']).doNothing())
    .returning('id')
    .executeTakeFirst();
