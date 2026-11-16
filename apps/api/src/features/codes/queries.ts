import { normalizeCode } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { escapeLike } from '../../shared/search.ts';
import { CODE_LIMIT, type CodesQuery } from './schemas.ts';

const codeRows = (db: Db, set: CodesQuery['set']) =>
  db
    .selectFrom('codes as c')
    .select(['c.code', 'c.description', 'c.is_billable'])
    .where('c.code_set', '=', set);

export const searchCodes = async (db: Db, { set, q, list, codes }: CodesQuery) => {
  if (codes) {
    return codes.length
      ? codeRows(db, set)
          .where(
            'c.code',
            'in',
            codes.map((c) => normalizeCode(set, c))
          )
          .orderBy('c.code')
          .execute()
      : [];
  }
  let query = codeRows(db, set).where('c.is_billable', '=', true);
  if (list) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('nemsis_pick_lists as p')
          .select('p.code')
          .where('p.list', '=', list)
          .whereRef('p.code_set', '=', 'c.code_set')
          .whereRef('p.code', '=', 'c.code')
      )
    );
  }
  if (q) {
    const prefix = `${escapeLike(normalizeCode(set, q))}%`;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    query = query
      .where((eb) =>
        eb.or([
          eb('c.code', 'like', prefix),
          eb.and(words.map((w) => eb('c.description', 'ilike', `%${escapeLike(w)}%`)))
        ])
      )
      .orderBy(sql`case when c.code like ${prefix} then length(c.code) end`)
      .orderBy(sql`case when c.code like ${prefix} then c.code end`)
      .orderBy(sql`word_similarity(${q}, c.description)`, 'desc')
      .orderBy(sql`length(c.description)`);
  }
  return query.orderBy('c.code').limit(CODE_LIMIT).execute();
};
