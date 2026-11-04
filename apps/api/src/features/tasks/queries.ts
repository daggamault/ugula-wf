import type { Db } from '@ugula/db';
import { sql } from 'kysely';

const detail = [
  'id',
  'run_id',
  'kind',
  'queue',
  'title',
  'subject',
  'priority',
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
    .select((eb) => [
      eb.fn.coalesce('ir.id', 'c.import_report_id').as('report_id'),
      eb.fn.coalesce('ir.pcr_number', 'c.pcr_number').as('pcr_number'),
      'c.id as claim_id',
      'c.number as claim_number',
      'c.status as claim_status',
      'p.first_name',
      'p.last_name'
    ])
    .where('r.id', '=', runId)
    .executeTakeFirst();

export const claimNext = (db: Db, agencyId: string, queue: string | null, userId: string) =>
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
