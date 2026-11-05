import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, SUBMISSIONS, within, zero } from './report-sql.ts';

export const productivityReport = report({
  dates: 'completed',
  rows: (db, ctx) => {
    const tasks = db
      .selectFrom('tasks as t')
      .select([
        sql<string>`t.completed_by`.as('user_id'),
        sql<number>`1`.as('tasks'),
        sql<number>`extract(epoch from t.completed_at - t.created_at) / 3600`.as('task_hours'),
        zero.as('submitted'),
        zero.as('posted')
      ])
      .where('t.agency_id', '=', ctx.agencyId)
      .where('t.status', '=', 'completed')
      .where('t.completed_by', 'is not', null)
      .where(within(sql.ref('t.completed_at'), ctx));
    const events = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select([
        sql<string>`e.created_by`.as('user_id'),
        zero.as('tasks'),
        zero.as('task_hours'),
        sql<number>`(e.kind <> 'response')::int`.as('submitted'),
        sql<number>`(e.kind = 'response')::int`.as('posted')
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('e.kind', 'in', [...SUBMISSIONS, 'response'])
      .where('e.created_by', 'is not', null)
      .where(within(sql.ref('e.created_at'), ctx));
    return db
      .selectFrom(tasks.unionAll(events).as('f'))
      .innerJoin('users as u', 'u.id', 'f.user_id')
      .select([
        'u.email as name',
        cents(sql.ref('f.tasks')).as('tasks'),
        cents(sql.ref('f.task_hours')).as('task_hours'),
        cents(sql.ref('f.submitted')).as('submitted'),
        cents(sql.ref('f.posted')).as('posted')
      ])
      .groupBy('u.email')
      .as('r');
  },
  columns: ['name', 'tasks', 'task_hours', 'submitted', 'posted'],
  order: 'tasks',
  tiebreak: 'name',
  dir: 'desc',
  totals: ['tasks', 'task_hours', 'submitted', 'posted']
});
