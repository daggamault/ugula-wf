import type { Db, RunStatus } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { RunSort } from './schemas.ts';

export type RunFilters = PageRequest<RunSort> & {
  status?: RunStatus;
  graphId?: string;
  rootOnly: boolean;
  q?: string | undefined;
};

export type StepFilters = {
  path?: string;
  node?: string;
  after: number;
  limit: number;
};

export const findPublishedVersion = (
  db: Db,
  tenantId: string,
  graphId: string,
  version?: number
) => {
  const base = db
    .selectFrom('graph_versions as gv')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .select(['gv.id', 'gv.version'])
    .where('g.id', '=', graphId)
    .where('g.kind', '=', 'workflow')
    .where('g.is_active', '=', true)
    .where('gv.published_at', 'is not', null)
    .where((eb) => eb.or([eb('g.tenant_id', '=', tenantId), eb('g.tenant_id', 'is', null)]));
  return (version === undefined ? base : base.where('gv.version', '=', version))
    .orderBy('gv.version', 'desc')
    .limit(1)
    .executeTakeFirst();
};

const runColumns = (db: Db) =>
  db
    .selectFrom('workflow_runs as r')
    .innerJoin('graph_versions as gv', 'gv.id', 'r.graph_version_id')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .select([
      'r.id',
      'r.status',
      'r.parent_id',
      'r.parent_index',
      'r.parent_wait',
      'r.created_at',
      'r.updated_at',
      'r.completed_at',
      'g.id as graph_id',
      'g.key',
      'g.name',
      'gv.version',
      'gv.id as version_id',
      sql<string | null>`r.error ->> 'message'`.as('error_message')
    ]);

const RUN_ORDER = {
  started: sql.ref('r.created_at'),
  workflow: sql`lower(g.name)`,
  status: sql.ref('r.status'),
  finished: sql.ref('r.completed_at')
};

export const listRuns = (db: Db, tenantId: string, f: RunFilters) => {
  let q = runColumns(db).where('r.tenant_id', '=', tenantId);
  if (f.status) q = q.where('r.status', '=', f.status);
  if (f.graphId) q = q.where('g.id', '=', f.graphId);
  if (f.rootOnly) q = q.where('r.parent_id', 'is', null);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([
        eb(sql`lower(g.name)`, 'like', like),
        eb(sql`lower(g.key)`, 'like', like),
        eb(sql`r.id::text`, 'like', like),
        eb(sql`lower(r.error ->> 'message')`, 'like', like)
      ])
    );
  }
  return paged(q, f, RUN_ORDER, sql.ref('r.id'));
};

export const findRun = (db: Db, tenantId: string, id: string) =>
  runColumns(db)
    .select(['r.inputs', 'r.result', 'r.error', 'r.state', 'r.wait_key'])
    .where('r.tenant_id', '=', tenantId)
    .where('r.id', '=', id)
    .executeTakeFirst();

export const findRunStatus = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('workflow_runs')
    .select('status')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', id)
    .executeTakeFirst();

const ANCESTOR_LIMIT = 32;

export const listAncestors = async (db: Db, runId: string) =>
  (
    await sql<{ id: string; name: string; status: RunStatus }>`
      with recursive chain (id, parent_id, depth) as (
        select id, parent_id, 0 from workflow_runs where id = ${runId}
        union all
        select w.id, w.parent_id, c.depth + 1
        from workflow_runs w join chain c on w.id = c.parent_id
        where c.depth < ${ANCESTOR_LIMIT}
      )
      select c.id, g.name, r.status
      from chain c
      join workflow_runs r on r.id = c.id
      join graph_versions gv on gv.id = r.graph_version_id
      join graphs g on g.id = gv.graph_id
      where c.depth > 0
      order by c.depth desc`.execute(db)
  ).rows;

const DETAIL_LIMIT = 200;

export const listChildren = (db: Db, runId: string) =>
  runColumns(db)
    .where('r.parent_id', '=', runId)
    .orderBy('r.parent_index')
    .limit(DETAIL_LIMIT)
    .execute();

export const countChildren = async (db: Db, runId: string) =>
  Number(
    (
      await db
        .selectFrom('workflow_runs')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('parent_id', '=', runId)
        .executeTakeFirstOrThrow()
    ).count
  );

export const listRunTasks = (db: Db, runId: string) =>
  db
    .selectFrom('tasks')
    .select(['id', 'kind', 'queue', 'title', 'status', 'outcomes', 'created_at', 'completed_at'])
    .where('run_id', '=', runId)
    .orderBy('created_at', 'desc')
    .limit(DETAIL_LIMIT)
    .execute();

export const listSteps = (db: Db, runId: string, f: StepFilters) => {
  let q = db
    .selectFrom('workflow_run_steps')
    .select([
      'seq',
      'scope',
      'path',
      'node',
      'node_type',
      'node_version',
      'event',
      'inputs',
      'outputs',
      'pin',
      'error',
      'started_at',
      'duration_ms'
    ])
    .where('run_id', '=', runId)
    .where('seq', '>', f.after);
  if (f.path !== undefined) q = q.where('path', '=', f.path);
  if (f.node !== undefined) q = q.where('node', '=', f.node);
  return q.orderBy('seq').limit(f.limit).execute();
};
