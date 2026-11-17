import type { Permission } from '@ugula/access';
import { dailyNumberOf } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { TaskSort } from './schemas.ts';

export type TaskFilters = PageRequest<TaskSort> & {
  q?: string | undefined;
  queue: readonly string[];
  assignee: readonly string[];
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

const TASK_FACETS = {
  queue: { value: sql.ref('t.queue') },
  assignee: { value: sql`coalesce(t.assignee_id::text, 'none')`, label: sql.ref('u.email') }
};

type TaskFacet = keyof typeof TASK_FACETS;

const filteredTasks = (db: Db, agencyId: string, f: TaskFilters, except?: TaskFacet) => {
  let q = db
    .selectFrom('tasks as t')
    .leftJoin('users as u', 'u.id', 't.assignee_id')
    .leftJoin('claim_runs as cr', 'cr.run_id', 't.run_id')
    .leftJoin('claims as c', 'c.id', 'cr.claim_id')
    .leftJoin('patients as p', 'p.id', 'c.patient_id')
    .where('t.agency_id', '=', agencyId)
    .where('t.status', '=', 'open');
  if (f.runId) q = q.where('t.run_id', '=', f.runId);
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
  return whereFacets(q, TASK_FACETS, f, except);
};

export const searchTasks = async (db: Db, agencyId: string, f: TaskFilters) => {
  const q = filteredTasks(db, agencyId, f).select([
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
  ]);
  const [page, facets] = await Promise.all([
    paged(q, f, taskOrder, sql.ref('t.id')),
    facetCounts((except) => filteredTasks(db, agencyId, f, except), TASK_FACETS)
  ]);
  return { ...page, facets };
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
  'completed_by_id'
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
      j
        .onRef('ir.agency_id', '=', 'r.agency_id')
        .on(sql<boolean>`ir.report_key = r.inputs -> 'report' ->> 'key'`)
    )
    .leftJoin('claim_runs as cr', 'cr.run_id', 'r.id')
    .leftJoin('claims as c', 'c.id', 'cr.claim_id')
    .select((eb) => [
      eb.fn.coalesce('ir.id', 'c.import_report_id').as('report_id'),
      eb.fn.coalesce('ir.pcr_number', 'c.pcr_number').as('pcr_number'),
      'c.id as claim_id'
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
      completed_by_id: input.userId,
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

export const logTaskDecision = (
  db: Db,
  input: { agencyId: string; taskId: string; runId: string; userId: string; note: string }
) =>
  db
    .insertInto('claim_events')
    .columns(['agency_id', 'claim_id', 'kind', 'note', 'created_by_id', 'task_id', 'source_key'])
    .expression((eb) =>
      eb
        .selectFrom('claim_runs as cr')
        .innerJoin('claims as c', 'c.id', 'cr.claim_id')
        .select([
          'cr.agency_id',
          'cr.claim_id',
          sql.lit('decided').as('kind'),
          sql.val(input.note).as('note'),
          sql.val(input.userId).as('created_by_id'),
          sql.val(input.taskId).as('task_id'),
          sql.val(`task:${input.taskId}`).as('source_key')
        ])
        .where('cr.agency_id', '=', input.agencyId)
        .where('cr.run_id', '=', input.runId)
    )
    .onConflict((oc) => oc.columns(['claim_id', 'source_key']).doNothing())
    .execute();
