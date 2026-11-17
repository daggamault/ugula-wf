import { type DirectoryPayer, type PayerStore, payerKey } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type PayerRow = { id: string; name: string; claim_filing: string };

const SIMILAR_LIMIT = 5;

const SIMILARITY = 0.3;

const nameKey = sql<string>`trim(regexp_replace(regexp_replace(normalize(lower(p.name), NFKD), '[\u0300-\u036f]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))`;

const payerOf = (p: PayerRow): DirectoryPayer => ({
  id: p.id,
  name: p.name,
  claimFiling: p.claim_filing
});

export const createPayerStore = (db: Kysely<Database>): PayerStore => ({
  findPayer: async (runId, name) => {
    const key = payerKey(name);
    if (!key) return { known: null, similar: [] };
    const { rows: known } = await sql<PayerRow>`
      with t as (select agency_id from workflow_runs where id = ${runId})
      select id, name, claim_filing from (
        select p.id, p.name, p.claim_filing, 0 as rank
        from payers p join t on t.agency_id = p.agency_id
        where ${nameKey} = ${key}
        union all
        select p.id, p.name, p.claim_filing, 1 as rank
        from payer_aliases a
        join t on t.agency_id = a.agency_id
        join payers p on p.id = a.payer_id
        where a.alias_key = ${key}
      ) matched
      order by rank
      limit 1
    `.execute(db);
    const [found] = known;
    if (found) return { known: payerOf(found), similar: [] };
    const { rows: similar } = await sql<PayerRow & { similarity: number }>`
      with t as (select agency_id from workflow_runs where id = ${runId})
      select p.id, p.name, p.claim_filing, similarity(${nameKey}, ${key}) as similarity
      from payers p join t on t.agency_id = p.agency_id
      where similarity(${nameKey}, ${key}) >= ${SIMILARITY}
      order by similarity desc, p.name
      limit ${SIMILAR_LIMIT}
    `.execute(db);
    return {
      known: null,
      similar: similar.map((r) => ({ ...payerOf(r), similarity: Number(r.similarity) }))
    };
  }
});
