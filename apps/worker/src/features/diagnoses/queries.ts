import type { DiagnosisStore } from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Embedder } from '@ugula/inference';
import type { PickList } from '@ugula/nemsis';
import { type Kysely, sql } from 'kysely';

const EMS_LISTS: PickList[] = ['impression', 'symptom'];

const scoreOf = (similarity: number) =>
  Math.round(Math.min(Math.max(similarity, 0), 1) * 1000) / 1000;

export const createDiagnosisStore = (db: Kysely<Database>, embedder: Embedder): DiagnosisStore => ({
  findBillable: async (codes) =>
    codes.length
      ? db
          .selectFrom('codes')
          .select(['code', 'description'])
          .where('code_set', '=', 'icd10cm')
          .where('is_billable', '=', true)
          .where('code', 'in', codes)
          .execute()
      : [],
  search: async (text, limit, emsOnly) => {
    const [vector] = await embedder.embed([text]);
    if (!vector) return [];
    const query = sql`${JSON.stringify(vector)}::vector`;
    const rows = await db
      .selectFrom('codes as c')
      .select([
        'c.code',
        'c.description',
        sql<number>`1 - (c.embedding <=> ${query})`.as('similarity')
      ])
      .where('c.embedding', 'is not', null)
      .where('c.code_set', '=', 'icd10cm')
      .where('c.is_billable', '=', true)
      .$if(emsOnly, (q) =>
        q.where((eb) =>
          eb.exists(
            eb
              .selectFrom('nemsis_pick_lists as p')
              .select('p.code')
              .where('p.list', 'in', EMS_LISTS)
              .whereRef('p.code_set', '=', 'c.code_set')
              .whereRef('p.code', '=', 'c.code')
          )
        )
      )
      .orderBy(sql`c.embedding <=> ${query}`)
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      code: r.code,
      description: r.description,
      score: scoreOf(Number(r.similarity))
    }));
  }
});
