import {
  type DirectoryPayer,
  type PayerCandidate,
  type PayerStore,
  payerDocument,
  payerKey,
  payerQuery
} from '@ugula/billing';
import type { Db } from '@ugula/db';
import { EMBED_BATCH_SIZE, type Embedder } from '@ugula/inference';
import { sql } from 'kysely';
import { isUuid } from '../../shared/ids.ts';
import { runAgency } from '../../shared/tenancy.ts';

type PayerRow = { id: string; name: string; claim_filing: string };

const CANDIDATE_LIMIT = 8;

const vector = (values: number[]) => `[${values.join(',')}]`;

const nameKey = sql<string>`trim(regexp_replace(regexp_replace(normalize(lower(p.name), NFKD), '[\\u0300-\\u036f]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))`;

const payerOf = (p: PayerRow): DirectoryPayer => ({
  id: p.id,
  name: p.name,
  claimFiling: p.claim_filing
});

const embedAll = async (embedder: Embedder, texts: string[]) => {
  const vectors = await embedder.embed(texts);
  if (vectors.length !== texts.length) {
    throw new Error(
      `The embeddings service returned ${vectors.length} vectors for ${texts.length} texts`
    );
  }
  return vectors.map(vector);
};

const findKnown = async (db: Db, runId: string, keys: string[]) => {
  const { rows } = await sql<{
    key: string;
    id: string | null;
    name: string | null;
    claim_filing: string | null;
    stocked: boolean;
  }>`
    with t as (select agency_id from workflow_runs where id = ${runId})
    select k.key, m.id, m.name, m.claim_filing,
      exists (select 1 from payers p join t on t.agency_id = p.agency_id) as stocked
    from unnest(${keys}::text[]) as k(key)
    left join lateral (
      select id, name, claim_filing from (
        select p.id, p.name, p.claim_filing, 0 as rank
        from payers p
        join t on t.agency_id = p.agency_id
        where ${nameKey} = k.key
        union all
        select p.id, p.name, p.claim_filing, 1 as rank
        from payer_aliases a
        join t on t.agency_id = a.agency_id
        join payers p on p.id = a.payer_id
        where a.alias_key = k.key
      ) matched
      order by rank
      limit 1
    ) m on true
  `.execute(db);
  return rows;
};

const embedPendingPayers = (db: Db, embedder: Embedder, runId: string) =>
  db.transaction().execute(async (tx) => {
    const pending = await tx
      .selectFrom('payers')
      .select(['id', 'name', 'claim_filing'])
      .where('agency_id', '=', runAgency(tx, runId))
      .where('embedding', 'is', null)
      .limit(EMBED_BATCH_SIZE)
      .forUpdate()
      .skipLocked()
      .execute();
    if (!pending.length) return;
    const vectors = await embedAll(
      embedder,
      pending.map((p) => payerDocument(payerOf(p)))
    );
    await tx
      .updateTable('payers as p')
      .from(
        sql<{ id: string; embedding: string }>`(values ${sql.join(
          pending.map((p, i) => sql`(${p.id}::uuid, ${vectors[i]}::vector)`)
        )})`.as(sql`v(id, embedding)`)
      )
      .set({ embedding: sql`v.embedding` })
      .whereRef('p.id', '=', sql.ref('v.id'))
      .execute();
  });

const nearest = async (db: Db, embedder: Embedder, runId: string, names: string[]) => {
  const vectors = await embedAll(embedder, names.map(payerQuery));
  const { rows } = await sql<PayerRow & { ord: string; similarity: number }>`
    select q.ord, c.id, c.name, c.claim_filing, c.similarity
    from unnest(${vectors}::text[]) with ordinality as q(v, ord)
    cross join lateral (
      select id, name, claim_filing, 1 - (embedding <=> q.v::vector) as similarity
      from payers
      where agency_id = ${runAgency(db, runId)} and embedding is not null
      order by embedding <=> q.v::vector
      limit ${CANDIDATE_LIMIT}
    ) c
    order by q.ord, c.similarity desc
  `.execute(db);
  const found = names.map((): PayerCandidate[] => []);
  for (const r of rows) {
    found[Number(r.ord) - 1]?.push({ ...payerOf(r), similarity: Number(r.similarity) });
  }
  return new Map(names.map((n, i) => [n, found[i] ?? []]));
};

const directoryVersion = (db: Db, runId: string) =>
  db
    .selectFrom('payers')
    .select(
      sql<string>`md5(coalesce(string_agg(id::text || ':' || updated_at::text, ',' order by id), ''))`.as(
        'version'
      )
    )
    .where('agency_id', '=', runAgency(db, runId));

export const createPayerStore = (db: Db, embedder: Embedder): PayerStore => ({
  lookup: async (runId, names, similar) => {
    if (!names.length) return [];
    const rows = await findKnown(db, runId, [...new Set(names.map(payerKey))]);
    const known = new Map(
      rows.flatMap((r) =>
        r.id && r.name && r.claim_filing
          ? [[r.key, payerOf({ id: r.id, name: r.name, claim_filing: r.claim_filing })] as const]
          : []
      )
    );
    const unknown = [...new Set(names.filter((n) => !known.has(payerKey(n))))];
    const search = similar && unknown.length > 0 && rows.some((r) => r.stocked);
    if (search) await embedPendingPayers(db, embedder, runId);
    const candidates = search ? await nearest(db, embedder, runId, unknown) : new Map();
    return names.map((name) => ({
      name,
      known: known.get(payerKey(name)) ?? null,
      candidates: candidates.get(name) ?? []
    }));
  },

  directory: async (runId) =>
    (
      await db
        .selectFrom('payers as p')
        .select(['p.id', 'p.name', 'p.claim_filing'])
        .where('p.agency_id', '=', runAgency(db, runId))
        .orderBy('p.name')
        .orderBy('p.id')
        .execute()
    ).map(payerOf),

  linkAlias: async (runId, name, payerId) => {
    const linked =
      payerKey(name) && isUuid(payerId)
        ? await db
            .insertInto('payer_aliases')
            .columns(['agency_id', 'payer_id', 'alias', 'alias_key'])
            .expression(
              db
                .selectFrom('payers')
                .select([
                  'agency_id',
                  'id',
                  sql<string>`${name}::text`.as('alias'),
                  sql<string>`${payerKey(name)}::text`.as('alias_key')
                ])
                .where('id', '=', payerId)
                .where('agency_id', '=', runAgency(db, runId))
            )
            .onConflict((oc) =>
              oc.columns(['agency_id', 'alias_key']).doUpdateSet({
                payer_id: (eb) => eb.ref('excluded.payer_id'),
                alias: (eb) => eb.ref('excluded.alias')
              })
            )
            .returning('id')
            .executeTakeFirst()
        : undefined;
    return linked !== undefined;
  },

  cachedSuggestion: async (runId, name) => {
    const row = await db
      .selectFrom('payer_suggestions')
      .select('payer_id')
      .where('agency_id', '=', runAgency(db, runId))
      .where('name_key', '=', payerKey(name))
      .where('directory_version', '=', directoryVersion(db, runId))
      .executeTakeFirst();
    return row ? row.payer_id : undefined;
  },

  cacheSuggestion: async (runId, name, payerId) => {
    const key = payerKey(name);
    if (!key) return;
    await db
      .insertInto('payer_suggestions')
      .columns(['agency_id', 'name_key', 'directory_version', 'payer_id'])
      .expression(
        db
          .selectFrom('workflow_runs as r')
          .select((eb) => [
            'r.agency_id',
            sql<string>`${key}::text`.as('name_key'),
            directoryVersion(db, runId).as('directory_version'),
            (payerId !== null && isUuid(payerId)
              ? eb
                  .selectFrom('payers as p')
                  .select('p.id')
                  .whereRef('p.agency_id', '=', 'r.agency_id')
                  .where('p.id', '=', payerId)
              : sql<string | null>`null::uuid`
            ).as('payer_id')
          ])
          .where('r.id', '=', runId)
      )
      .onConflict((oc) =>
        oc
          .columns(['agency_id', 'name_key', 'directory_version'])
          .doUpdateSet({ payer_id: (eb) => eb.ref('excluded.payer_id') })
      )
      .execute();
  }
});
