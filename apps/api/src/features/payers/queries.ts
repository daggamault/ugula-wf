import type { ClaimFilingCode } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { Writes } from '../../shared/access.ts';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { PayerInput, PayerSort } from './schemas.ts';

const columns = [
  'id',
  'name',
  'payer_code',
  'claim_filing',
  'filing_limit_days',
  'correction_method',
  'appeal_days',
  'plan_type',
  'is_searchable',
  'updated_at'
] as const;

export type PayerFilters = PageRequest<PayerSort> & {
  q?: string | undefined;
  filing: readonly ClaimFilingCode[];
};

const payerRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('payers as p')
    .select((eb) => [
      ...columns.map((c) => `p.${c}` as const),
      jsonArrayFrom(
        eb
          .selectFrom('payer_aliases as a')
          .select(['a.id', 'a.alias'])
          .whereRef('a.payer_id', '=', 'p.id')
          .orderBy(sql`lower(a.alias)`)
      ).as('aliases')
    ])
    .where('p.agency_id', '=', agencyId);

const PAYER_ORDER = {
  name: sql`lower(p.name)`,
  payerCode: sql`lower(p.payer_code)`,
  filing: sql.ref('p.claim_filing')
};

const PAYER_FACETS = { filing: { value: sql.ref('p.claim_filing') } };

type PayerFacet = keyof typeof PAYER_FACETS;

const filteredPayers = (db: Db, agencyId: string, f: PayerFilters, except?: PayerFacet) => {
  let q = payerRows(db, agencyId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(p.name)`, 'like', like),
        eb(sql`lower(p.payer_code)`, 'like', like),
        eb.exists(
          eb
            .selectFrom('payer_aliases as m')
            .select('m.id')
            .whereRef('m.payer_id', '=', 'p.id')
            .where(sql`lower(m.alias)`, 'like', like)
        )
      ])
    );
  }
  return whereFacets(q, PAYER_FACETS, f, except);
};

export const searchPayers = async (db: Db, agencyId: string, f: PayerFilters) => {
  const [page, facets] = await Promise.all([
    paged(filteredPayers(db, agencyId, f), f, PAYER_ORDER, sql.ref('p.id')),
    facetCounts((except) => filteredPayers(db, agencyId, f, except), PAYER_FACETS)
  ]);
  return { ...page, facets };
};

export const findPayer = (db: Db, agencyId: string, id: string) =>
  payerRows(db, agencyId).where('p.id', '=', id).executeTakeFirst();

const NAME_LIMIT = 50;

export const listPayerNames = (db: Db, agencyId: string, text?: string) => {
  const q = db
    .selectFrom('payers')
    .select(['id', 'name'])
    .where('agency_id', '=', agencyId)
    .orderBy(sql`lower(name)`)
    .limit(NAME_LIMIT);
  return (text ? q.where(sql`lower(name)`, 'like', containsPattern(text)) : q).execute();
};

const changes = (p: PayerInput) => ({
  payer_code: p.payerCode,
  claim_filing: p.claimFiling,
  filing_limit_days: p.filingLimitDays,
  correction_method: p.correctionMethod,
  appeal_days: p.appealDays,
  plan_type: p.planType,
  is_searchable: p.isSearchable,
  updated_at: sql<Date>`now()`
});

const saved = [...columns, sql<boolean>`embedding is null`.as('unembedded')] as const;

const insertPayer = (db: Db, agencyId: string, p: PayerInput, update: boolean) =>
  db
    .insertInto('payers')
    .values({
      agency_id: agencyId,
      name: p.name,
      payer_code: p.payerCode,
      claim_filing: p.claimFiling,
      filing_limit_days: p.filingLimitDays,
      correction_method: p.correctionMethod,
      appeal_days: p.appealDays,
      plan_type: p.planType,
      is_searchable: p.isSearchable
    })
    .onConflict((oc) => {
      const key = oc.expression(sql`agency_id, lower(name)`);
      return update
        ? key.doUpdateSet({
            ...changes(p),
            embedding: sql`case when payers.claim_filing = excluded.claim_filing then payers.embedding end`
          })
        : key.doNothing();
    })
    .returning(saved)
    .executeTakeFirst();

const updatePayer = (db: Db, agencyId: string, p: PayerInput) =>
  db
    .updateTable('payers')
    .set({
      ...changes(p),
      embedding: sql`case when claim_filing = ${p.claimFiling} then embedding end`
    })
    .where('agency_id', '=', agencyId)
    .where(sql`lower(name)`, '=', p.name.toLowerCase())
    .returning(saved)
    .executeTakeFirst();

export const upsertPayer = (db: Db, agencyId: string, p: PayerInput, writes: Writes) =>
  writes.create ? insertPayer(db, agencyId, p, writes.update) : updatePayer(db, agencyId, p);

export const setEmbedding = (db: Db, agencyId: string, id: string, embedding: number[]) =>
  db
    .updateTable('payers')
    .set({ embedding: sql`${`[${embedding.join(',')}]`}::vector` })
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .where('embedding', 'is', null)
    .execute();

export const deletePayer = async (db: Db, agencyId: string, id: string) =>
  (await db
    .deleteFrom('payers')
    .where('id', '=', id)
    .where('agency_id', '=', agencyId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const deleteAlias = async (db: Db, agencyId: string, payerId: string, aliasId: string) =>
  (await db
    .deleteFrom('payer_aliases')
    .where('id', '=', aliasId)
    .where('payer_id', '=', payerId)
    .where('agency_id', '=', agencyId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const linkCoverages = async (
  db: Db,
  agencyId: string,
  payer: { id: string; name: string }
) =>
  (
    await db
      .updateTable('claim_coverages as cc')
      .set({ payer_id: payer.id })
      .from('claims as c')
      .whereRef('c.id', '=', 'cc.claim_id')
      .where('c.agency_id', '=', agencyId)
      .where('cc.payer_id', 'is', null)
      .where(sql`lower(cc.payer_name)`, '=', payer.name.toLowerCase())
      .returning('cc.claim_id')
      .execute()
  ).length;
