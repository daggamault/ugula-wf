import { sql } from 'kysely';
import { report } from './report.ts';
import { count, countWhere } from './report-sql.ts';

const TASK_AGES = [
  ['days_0_1', null, 1],
  ['days_2_7', 2, 7],
  ['days_8_30', 8, 30],
  ['days_over_30', 31, null]
] as const;

export const workQueueReport = report({
  dates: null,
  groups: ['queue', 'assignee'],
  rows: (db, ctx) => {
    const age = sql`floor(extract(epoch from ${ctx.now}::timestamptz - t.created_at) / 86400)`;
    return db
      .selectFrom('tasks as t')
      .leftJoin('users as u', 'u.id', 't.assignee_id')
      .select([
        (ctx.group === 'assignee' ? sql<string | null>`u.email` : sql<string | null>`t.queue`).as(
          'name'
        ),
        count.as('open'),
        countWhere(sql`t.assignee_id is null`).as('unassigned'),
        ...TASK_AGES.map(([key, min, max]) =>
          countWhere(
            min === null
              ? sql`${age} <= ${max}`
              : max === null
                ? sql`${age} >= ${min}`
                : sql`${age} between ${min} and ${max}`
          ).as(key)
        ),
        sql<Date>`min(t.created_at)`.as('oldest_at')
      ])
      .where('t.agency_id', '=', ctx.agencyId)
      .where('t.status', '=', 'open')
      .groupBy(sql`1`)
      .as('r');
  },
  columns: ['name', 'open', 'unassigned', ...TASK_AGES.map(([key]) => key), 'oldest_at'],
  order: 'open',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['open', 'unassigned', ...TASK_AGES.map(([key]) => key)]
});
