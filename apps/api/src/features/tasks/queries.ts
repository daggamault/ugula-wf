import type { Permission } from '@ugula/access';
import { dailyNumberOf } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { TaskSort } from './schemas.ts';

export type TaskFilters = PageRequest<TaskSort> & {
  q?: string | undefined;
  queue?: string | undefined;
  assignee: 'mine' | 'unassigned' | 'all';
  runId?: string | undefined;
};

const taskOrder = {
  waiting: sql.ref('t.created_at'),
  priority: sql.ref('t.priority'),
  due: sql.ref('t.due_at'),
  title: sql`lower(t.title)`,
  queue: sql.ref('t.queue'),
  claim: sql.ref('c.number'),
  assignee: sql.ref('u.email')
} as const;

export const listTasks = (db: Db, agencyId: string, userId: string, f: TaskFilters) => {
  let q = db
    .selectFrom('tasks as t')
    .leftJoin('users as u', 'u.id', 't.assignee_id')
    .leftJoin('claim_runs as cr', 'cr.run_id', 't.run_id')
    .leftJoin('claims as c', 'c.id', 'cr.claim_id')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .select([
      't.id',
      't.kind',
      't.queue',
      't.title',
      't.subject',
      't.priority',
      't.due_at',
      't.assignee_id',
      'u.email as assignee_email',
      't.created_at',
      'c.id as claim_id',
      'c.number as claim_number',
      'p.first_name',
      'p.last_name'
    ])
    .where('t.agency_id', '=', agencyId)
    .where('t.status', '=', 'open');
  if (f.queue) q = q.where('t.queue', '=', f.queue);
  if (f.runId) q = q.where('t.run_id', '=', f.runId);
  if (f.assignee === 'mine') q = q.where('t.assignee_id', '=', userId);
  if (f.assignee === 'unassigned') q = q.where('t.assignee_id', 'is', null);
  if (f.q) {
    const pattern = containsPattern(f.q);
    const number = dailyNumberOf(f.q);
    const text = f.q.trim();
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(t.title)`, 'like', pattern),
        eb(sql`lower(t.subject)`, 'like', pattern),
        eb(sql`lower(p.last_name || ', ' || p.first_name)`, 'like', pattern),
        eb('c.pcr_number', '=', text),
        ...(number === null ? [] : [eb('c.number', '=', number)])
      ])
    );
  }
  return paged(q, f, taskOrder, sql.ref('t.id'));
};

const detail = [
  'id',
  'run_id',
  'kind',
  'queue',
  'title',
  'subject',
  'summary',
  'priority',
  'due_at',
  'permission',
  'status',
  'assignee_id',
  'created_at',
  'completed_at',
  'wait_id',
  'instructions',
  'context',
  'fields',
  'outcomes',
  'defaults',
  'hints',
  'prefill',
  'resolution',
  'completed_by'
] as const;

export const listQueues = (db: Db, agencyId: string, userId: string) =>
  db
    .selectFrom('tasks')
    .select([
      'queue',
      sql<number>`count(*)::int`.as('open'),
      sql<number>`(count(*) filter (where assignee_id is null))::int`.as('unassigned'),
      sql<number>`(count(*) filter (where assignee_id = ${userId}))::int`.as('mine'),
      sql<Date>`min(created_at)`.as('oldest')
    ])
    .where('agency_id', '=', agencyId)
    .where('status', '=', 'open')
    .groupBy('queue')
    .orderBy('queue')
    .execute();

export const findTask = (db: Db, agencyId: string, id: string) =>
  db
    .selectFrom('tasks')
    .select(detail)
    .where('agency_id', '=', agencyId)
    .where('id', '=', id)
    .executeTakeFirst();

export const findTaskSource = (db: Db, runId: string) =>
  db
    .selectFrom('workflow_runs as r')
    .leftJoin('import_reports as ir', (j) =>
      j.on(sql<boolean>`ir.report ->> 'key' = r.inputs -> 'report' ->> 'key'`)
    )
    .leftJoin('claim_runs as cr', 'cr.run_id', 'r.id')
    .leftJoin('claims as c', 'c.id', 'cr.claim_id')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .leftJoin('claim_balances as b', 'b.claim_id', 'c.id')
    .select((eb) => [
      eb.fn.coalesce('ir.id', 'c.import_report_id').as('report_id'),
      eb.fn.coalesce('ir.pcr_number', 'c.pcr_number').as('pcr_number'),
      'c.id as claim_id',
      'c.number as claim_number',
      'c.status as claim_status',
      'c.service_date',
      'c.trip_type',
      'c.level',
      'c.emergency',
      'c.loaded_miles',
      'c.total_cents',
      'b.balance_cents',
      'p.id as patient_id',
      'p.number as patient_number',
      'p.first_name',
      'p.last_name',
      'p.birth_date',
      'p.gender',
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code',
      jsonArrayFrom(
        eb
          .selectFrom('claim_coverages as cc')
          .select(['cc.payer_name as payer', 'cc.member_id as memberId', 'cc.eligibility'])
          .whereRef('cc.claim_id', '=', 'c.id')
          .orderBy('cc.position')
      ).as('payers'),
      jsonArrayFrom(
        eb
          .selectFrom('claim_lines as l')
          .select(['l.code', 'l.units', 'l.total_cents as totalCents'])
          .whereRef('l.claim_id', '=', 'c.id')
          .orderBy('l.position')
      ).as('lines')
    ])
    .where('r.id', '=', runId)
    .executeTakeFirst();

export const claimNext = (
  db: Db,
  agencyId: string,
  queue: string | null,
  userId: string,
  permissions: readonly Permission[]
) =>
  db
    .updateTable('tasks')
    .set({ assignee_id: userId, updated_at: sql`now()` })
    .where('id', '=', (eb) => {
      const open = eb
        .selectFrom('tasks')
        .select('id')
        .where('agency_id', '=', agencyId)
        .where('status', '=', 'open');
      return (queue ? open.where('queue', '=', queue) : open)
        .where((w) => w.or([w('assignee_id', 'is', null), w('assignee_id', '=', userId)]))
        .where((w) =>
          w.or([
            w('permission', 'is', null),
            sql<boolean>`permission = any(${[...permissions]}::text[])`
          ])
        )
        .orderBy(sql`assignee_id is null`)
        .orderBy('priority', 'desc')
        .orderBy('created_at')
        .limit(1)
        .forUpdate()
        .skipLocked();
    })
    .returning(detail)
    .executeTakeFirst();

export const assignTask = (
  db: Db,
  input: { agencyId: string; id: string; userId: string; assignee: string | null }
) =>
  db
    .updateTable('tasks')
    .set({ assignee_id: input.assignee, updated_at: sql`now()` })
    .where('agency_id', '=', input.agencyId)
    .where('id', '=', input.id)
    .where('status', '=', 'open')
    .where((eb) => eb.or([eb('assignee_id', 'is', null), eb('assignee_id', '=', input.userId)]))
    .returning('id')
    .executeTakeFirst();

export const completeTask = (
  db: Db,
  input: { agencyId: string; id: string; userId: string; resolution: unknown }
) =>
  db
    .updateTable('tasks')
    .set({
      status: 'completed',
      completed_by: input.userId,
      completed_at: sql`now()`,
      resolution: JSON.stringify(input.resolution),
      updated_at: sql`now()`
    })
    .where('agency_id', '=', input.agencyId)
    .where('id', '=', input.id)
    .where('status', '=', 'open')
    .where((eb) => eb.or([eb('assignee_id', 'is', null), eb('assignee_id', '=', input.userId)]))
    .returning('id')
    .executeTakeFirst();
