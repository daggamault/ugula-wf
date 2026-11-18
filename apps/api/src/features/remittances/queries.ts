import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { RemittanceSort } from './schemas.ts';

export type RemittanceFilters = PageRequest<RemittanceSort> & {
  q?: string | undefined;
  state: readonly string[];
};

const remittanceRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('remittances as r')
    .innerJoin('clearinghouse_files as f', 'f.id', 'r.file_id')
    .select((eb) => [
      'r.id',
      'r.created_at',
      'r.paid_on',
      'r.payer_name',
      'r.payer_code',
      'r.trace_number',
      'r.payment_method',
      'r.total_cents',
      'r.claim_paid_cents',
      'r.provider_adjustment_cents',
      'r.unmatched_count',
      'r.is_balanced',
      'r.reconciled_at',
      'f.file_name',
      eb
        .selectFrom('claim_payments as p')
        .select((s) => s.fn.countAll<number>().as('n'))
        .whereRef('p.remittance_id', '=', 'r.id')
        .as('payment_count')
    ])
    .where('r.agency_id', '=', agencyId);

const ORDER = {
  received: sql.ref('r.created_at'),
  paid: sql.ref('r.paid_on'),
  payer: sql`lower(r.payer_name)`,
  total: sql.ref('r.total_cents')
};

const FACETS = {
  state: {
    value: sql`case when r.reconciled_at is null then 'open' else 'reconciled' end`
  }
};

type RemittanceFacet = keyof typeof FACETS;

const filtered = (db: Db, agencyId: string, f: RemittanceFilters, except?: RemittanceFacet) => {
  let q = remittanceRows(db, agencyId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(coalesce(r.payer_name, ''))`, 'like', like),
        eb(sql`lower(coalesce(r.trace_number, ''))`, 'like', like)
      ])
    );
  }
  return whereFacets(q, FACETS, f, except);
};

export const searchRemittances = async (db: Db, agencyId: string, f: RemittanceFilters) => {
  const [page, facets] = await Promise.all([
    paged(filtered(db, agencyId, f), f, ORDER, sql.ref('r.id')),
    facetCounts((except) => filtered(db, agencyId, f, except), FACETS)
  ]);
  return { ...page, facets };
};

export const findRemittance = (db: Db, agencyId: string, id: string) =>
  remittanceRows(db, agencyId)
    .leftJoin('users as u', 'u.id', 'r.reconciled_by')
    .select([
      'r.reconcile_note',
      sql<string | null>`nullif(concat_ws(' ', u.first_name, u.last_name), '')`.as('reconciled_by')
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();

export const findRemittancePayments = (db: Db, agencyId: string, id: string) =>
  db
    .selectFrom('claim_payments as p')
    .leftJoin('claims as c', 'c.id', 'p.claim_id')
    .select([
      'p.id',
      'p.claim_id',
      'p.claim_number',
      'p.coverage_position',
      'p.outcome',
      'p.status_code',
      'p.charge_cents',
      'p.paid_cents',
      'p.patient_cents',
      'p.payer_claim_number',
      'p.adjustments',
      'p.remarks',
      'c.patient_first_name as first_name',
      'c.patient_last_name as last_name'
    ])
    .where('p.agency_id', '=', agencyId)
    .where('p.remittance_id', '=', id)
    .orderBy('p.created_at')
    .orderBy('p.id')
    .execute();
