import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, within, zero } from './report-sql.ts';

export const productivityReport = report({
  dates: 'completed',
  rows: (db, ctx) => {
    const tasks = db
      .selectFrom('tasks as t')
      .select([
        sql<string>`t.completed_by_id`.as('user_id'),
        sql<number>`1`.as('tasks'),
        sql<number>`extract(epoch from t.completed_at - t.created_at) / 3600`.as('task_hours'),
        zero.as('posted')
      ])
      .where('t.agency_id', '=', ctx.agencyId)
      .where('t.status', '=', 'completed')
      .where('t.completed_by_id', 'is not', null)
      .where(within(sql.ref('t.completed_at'), ctx));
    const events = db
      .selectFrom('claim_events as e')
      .select([
        sql<string>`e.created_by_id`.as('user_id'),
        zero.as('tasks'),
        zero.as('task_hours'),
        sql<number>`1`.as('posted')
      ])
      .where('e.agency_id', '=', ctx.agencyId)
      .where('e.kind', '=', 'response')
      .where('e.created_by_id', 'is not', null)
      .where(within(sql.ref('e.created_at'), ctx));
    return db
      .selectFrom(tasks.unionAll(events).as('f'))
      .innerJoin('users as u', 'u.id', 'f.user_id')
      .select([
        'u.email as name',
        cents(sql.ref('f.tasks')).as('tasks'),
        cents(sql.ref('f.task_hours')).as('task_hours'),
        cents(sql.ref('f.posted')).as('posted')
      ])
      .groupBy('u.email')
      .as('r');
  },
  columns: ['name', 'tasks', 'task_hours', 'posted'],
  order: 'tasks',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['tasks', 'task_hours', 'posted']
});
