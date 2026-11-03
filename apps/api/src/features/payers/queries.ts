import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { PayerInput, PayerSort } from './schemas.ts';

type Db = Kysely<Database>;

const columns = [
  'id',
  'name',
  'payer_id',
  'claim_filing',
  'filing_limit_days',
  'updated_at'
] as const;

export type PayerFilters = PageRequest<PayerSort> & { q?: string | undefined };

const payerRows = (db: Db, tenantId: string) =>
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
    .where('p.tenant_id', '=', tenantId);

const PAYER_ORDER = {
  name: sql`lower(p.name)`,
  payerId: sql`lower(p.payer_id)`,
  filing: sql.ref('p.claim_filing')
};

export const searchPayers = (db: Db, tenantId: string, f: PayerFilters) => {
  let q = payerRows(db, tenantId);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(p.name)`, 'like', like),
        eb(sql`lower(p.payer_id)`, 'like', like),
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
  return paged(q, f, PAYER_ORDER, sql.ref('p.id'));
};

export const findPayer = (db: Db, tenantId: string, id: string) =>
  payerRows(db, tenantId).where('p.id', '=', id).executeTakeFirst();

const NAME_LIMIT = 50;

export const listPayerNames = (db: Db, tenantId: string, text?: string) => {
  const q = db
    .selectFrom('payers')
    .select(['id', 'name'])
    .where('tenant_id', '=', tenantId)
    .orderBy(sql`lower(name)`)
    .limit(NAME_LIMIT);
  return (text ? q.where(sql`lower(name)`, 'like', containsPattern(text)) : q).execute();
};

export const upsertPayer = (db: Db, tenantId: string, p: PayerInput) =>
  db
    .insertInto('payers')
    .values({
      tenant_id: tenantId,
      name: p.name,
      payer_id: p.payerId,
      claim_filing: p.claimFiling,
      filing_limit_days: p.filingLimitDays
    })
    .onConflict((oc) =>
      oc.expression(sql`tenant_id, lower(name)`).doUpdateSet({
        payer_id: p.payerId,
        claim_filing: p.claimFiling,
        filing_limit_days: p.filingLimitDays,
        embedding: sql`case when payers.claim_filing = excluded.claim_filing then payers.embedding end`,
        updated_at: sql`now()`
      })
    )
    .returning([...columns, sql<boolean>`embedding is null`.as('unembedded')])
    .executeTakeFirstOrThrow();

export const saveEmbedding = (db: Db, tenantId: string, id: string, embedding: number[]) =>
  db
    .updateTable('payers')
    .set({ embedding: sql`${`[${embedding.join(',')}]`}::vector` })
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .where('embedding', 'is', null)
    .execute();

export const deletePayer = async (db: Db, tenantId: string, id: string) =>
  (await db
    .deleteFrom('payers')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const deleteAlias = async (db: Db, tenantId: string, payerId: string, aliasId: string) =>
  (await db
    .deleteFrom('payer_aliases')
    .where('id', '=', aliasId)
    .where('payer_id', '=', payerId)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

export const linkCoverages = async (
  db: Db,
  tenantId: string,
  payer: { id: string; name: string }
) =>
  (
    await db
      .updateTable('claim_coverages as cc')
      .set({ payer_id: payer.id })
      .from('claims as c')
      .whereRef('c.id', '=', 'cc.claim_id')
      .where('c.tenant_id', '=', tenantId)
      .where('cc.payer_id', 'is', null)
      .where(sql`lower(cc.payer_name)`, '=', payer.name.toLowerCase())
      .returning('cc.claim_id')
      .execute()
  ).length;
