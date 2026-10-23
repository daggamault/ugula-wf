import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import type { PayerInput } from './schemas.ts';

type Db = Kysely<Database>;

const columns = ['id', 'name', 'payer_id', 'claim_filing', 'updated_at'] as const;

export const listPayers = (db: Db, tenantId: string) =>
  db
    .selectFrom('payers')
    .select(columns)
    .where('tenant_id', '=', tenantId)
    .orderBy(sql`lower(name)`)
    .execute();

export const upsertPayer = (db: Db, tenantId: string, p: PayerInput) =>
  db
    .insertInto('payers')
    .values({ tenant_id: tenantId, name: p.name, payer_id: p.payerId, claim_filing: p.claimFiling })
    .onConflict((oc) =>
      oc.expression(sql`tenant_id, lower(name)`).doUpdateSet({
        payer_id: p.payerId,
        claim_filing: p.claimFiling,
        updated_at: sql`now()`
      })
    )
    .returning(columns)
    .executeTakeFirstOrThrow();

export const deletePayer = async (db: Db, tenantId: string, id: string) =>
  (await db
    .deleteFrom('payers')
    .where('id', '=', id)
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
