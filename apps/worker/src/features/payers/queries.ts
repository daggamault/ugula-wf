import {
  type DirectoryPayer,
  type PayerCandidate,
  type PayerStore,
  payerDocument,
  payerKey,
  payerQuery
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Embedder } from '@ugula/inference';
import { type Kysely, sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runTenant } from '../../shared/tenancy.ts';

type Db = Kysely<Database>;

const CANDIDATE_LIMIT = 8;

const vector = (values: number[]) => `[${values.join(',')}]`;

const embedDirectory = async (db: Db, embedder: Embedder, payers: DirectoryPayer[]) => {
  if (!payers.length) return;
  const vectors = await embedder.embed(payers.map(payerDocument));
  await db
    .updateTable('payers as p')
    .from(
      sql<{ id: string; embedding: string }>`(values ${sql.join(
        payers.map((p, i) => sql`(${p.id}::uuid, ${vector(vectors[i] ?? [])}::vector)`)
      )})`.as(sql`v(id, embedding)`)
    )
    .set({ embedding: sql`v.embedding` })
    .whereRef('p.id', '=', sql.ref('v.id'))
    .execute();
};

const nearest = async (db: Db, runId: string, query: number[]): Promise<PayerCandidate[]> => {
  const distance = sql<number>`embedding <=> ${vector(query)}::vector`;
  const rows = await db
    .selectFrom('payers')
    .select(['id', 'name', 'claim_filing', sql<number>`1 - (${distance})`.as('similarity')])
    .where('tenant_id', '=', runTenant(db, runId))
    .where('embedding', 'is not', null)
    .orderBy(distance)
    .limit(CANDIDATE_LIMIT)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    claimFiling: r.claim_filing,
    similarity: Number(r.similarity)
  }));
};

export const createPayerStore = (db: Db, embedder: Embedder): PayerStore => ({
  lookup: async (runId, names) => {
    if (!names.length) return [];
    const keys = [...new Set(names.map(payerKey))];
    const [directory, aliases] = await Promise.all([
      db
        .selectFrom('payers')
        .select(['id', 'name', 'claim_filing', sql<boolean>`embedding is null`.as('unembedded')])
        .where('tenant_id', '=', runTenant(db, runId))
        .execute(),
      db
        .selectFrom('payer_aliases as a')
        .innerJoin('payers as p', 'p.id', 'a.payer_id')
        .select(['a.alias_key', 'p.id', 'p.name', 'p.claim_filing'])
        .where('a.tenant_id', '=', runTenant(db, runId))
        .where('a.alias_key', 'in', keys)
        .execute()
    ]);
    const payerOf = (p: { id: string; name: string; claim_filing: string }): DirectoryPayer => ({
      id: p.id,
      name: p.name,
      claimFiling: p.claim_filing
    });
    const known = new Map<string, DirectoryPayer>([
      ...aliases.map((a) => [a.alias_key, payerOf(a)] as const),
      ...directory.map((p) => [payerKey(p.name), payerOf(p)] as const)
    ]);
    const unknown = [...new Set(names.filter((n) => !known.has(payerKey(n))))];
    const candidates = new Map<string, PayerCandidate[]>();
    if (unknown.length && directory.length) {
      await embedDirectory(db, embedder, directory.filter((p) => p.unembedded).map(payerOf));
      const vectors = await embedder.embed(unknown.map(payerQuery));
      const found = await Promise.all(vectors.map((v) => nearest(db, runId, v)));
      for (const [i, name] of unknown.entries()) candidates.set(name, found[i] ?? []);
    }
    return names.map((name) => ({
      name,
      known: known.get(payerKey(name)) ?? null,
      candidates: candidates.get(name) ?? []
    }));
  },

  linkAlias: async (runId, name, payerId) => {
    if (!payerKey(name)) throw new Error(`"${name}" is not a payer name`);
    const linked = isUuid(payerId)
      ? await db
          .insertInto('payer_aliases')
          .columns(['tenant_id', 'payer_id', 'alias', 'alias_key'])
          .expression(
            db
              .selectFrom('payers')
              .select([
                'tenant_id',
                'id',
                sql<string>`${name}::text`.as('alias'),
                sql<string>`${payerKey(name)}::text`.as('alias_key')
              ])
              .where('id', '=', payerId)
              .where('tenant_id', '=', runTenant(db, runId))
          )
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'alias_key']).doUpdateSet({
              payer_id: (eb) => eb.ref('excluded.payer_id'),
              alias: (eb) => eb.ref('excluded.alias')
            })
          )
          .returning('id')
          .executeTakeFirst()
      : undefined;
    if (!linked) throw new Error(`Payer ${payerId} is not in the directory`);
  }
});
