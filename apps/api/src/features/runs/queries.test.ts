import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  countChildren,
  findPublishedVersion,
  findRun,
  findRunStatus,
  listAncestors,
  listChildren,
  listRunTasks,
  listSteps,
  searchRuns
} from './queries.ts';

const flat = (sql: string | undefined) => sql?.replace(/\s+/g, ' ').trim();

const PAGE = { rootOnly: false, page: 1, pageSize: 10, sort: 'started', dir: 'desc' } as const;

const RUN_COLUMNS =
  'select "r"."id", "r"."status", "r"."parent_id", "r"."parent_index", "r"."parent_wait", "r"."created_at", "r"."updated_at", "r"."completed_at", "g"."id" as "graph_id", "g"."key", "g"."name", "gv"."version", "gv"."id" as "version_id", r.error ->> \'message\' as "error_message"';

const RUN_FROM =
  'from "workflow_runs" as "r" inner join "graph_versions" as "gv" on "gv"."id" = "r"."graph_version_id" inner join "graphs" as "g" on "g"."id" = "gv"."graph_id"';

describe('searchRuns', () => {
  it('pages the agency’s runs newest first', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r1', total: '1' }]);
    assert.deepEqual(await searchRuns(db, 't-1', PAGE), {
      items: [{ id: 'r1' }],
      total: 1,
      page: 1,
      pageSize: 10
    });
    assert.equal(
      queries[0]?.sql,
      `${RUN_COLUMNS}, count(*) over () as "total" ${RUN_FROM} where "r"."agency_id" = $1 order by "r"."created_at" desc nulls last, "r"."id" desc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 10, 0]);
  });

  it('narrows to a status, a workflow and top-level runs, sorted by workflow name', async () => {
    const { db, queries } = createRecordingDb();
    await searchRuns(db, 't-1', {
      ...PAGE,
      status: 'faulted',
      graphId: 'g1',
      rootOnly: true,
      sort: 'workflow',
      dir: 'asc'
    });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${RUN_FROM} where "r"."agency_id" = $1 and "r"."status" = $2 and "g"."id" = $3 and "r"."parent_id" is null order by lower(g.name) asc nulls last, "r"."id" asc limit $4 offset $5`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'faulted', 'g1', 10, 0]);
  });

  it('searches workflow names, keys, run ids and error messages within the agency', async () => {
    const { db, queries } = createRecordingDb();
    await searchRuns(db, 't-1', { ...PAGE, q: ' Ingest%' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${RUN_FROM} where "r"."agency_id" = $1 and (lower(g.name) like $2 or lower(g.key) like $3 or r.id::text like $4 or lower(r.error ->> 'message') like $5) order by "r"."created_at" desc nulls last, "r"."id" desc limit $6 offset $7`
      )
    );
    const like = '%ingest\\%%';
    assert.deepEqual(queries[0]?.parameters, ['t-1', like, like, like, like, 10, 0]);
  });

  it('sorts by status or finish time', async () => {
    const { db, queries } = createRecordingDb();
    await searchRuns(db, 't-1', { ...PAGE, sort: 'status' });
    await searchRuns(db, 't-1', { ...PAGE, sort: 'finished' });
    assert.ok(
      queries[0]?.sql.endsWith(
        'order by "r"."status" desc nulls last, "r"."id" desc limit $2 offset $3'
      )
    );
    assert.ok(
      queries[1]?.sql.endsWith(
        'order by "r"."completed_at" desc nulls last, "r"."id" desc limit $2 offset $3'
      )
    );
  });
});

describe('findPublishedVersion', () => {
  it('picks the newest published version of an active system or agency workflow', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'v1', version: 4, key: 'k', base: true }
    ]);
    assert.deepEqual(await findPublishedVersion(db, { agencyId: 't-1' }, 'g1'), {
      id: 'v1',
      version: 4,
      key: 'k',
      base: true
    });
    assert.equal(
      flat(queries[0]?.sql),
      'select "gv"."id", "gv"."version", "g"."key", g.agency_id is null as "base" from "graph_versions" as "gv" inner join "graphs" as "g" on "g"."id" = "gv"."graph_id" where "g"."id" = $1 and "g"."kind" = $2 and "g"."is_active" = $3 and "gv"."published_at" is not null and ( "g"."agency_id" is null or ("g"."is_active" and "g"."agency_id" = $4::uuid) ) order by "gv"."version" desc limit $5'
    );
    assert.deepEqual(queries[0]?.parameters, ['g1', 'workflow', true, 't-1', 1]);
  });

  it('picks a requested version', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findPublishedVersion(db, { agencyId: 't-1' }, 'g1', 2), undefined);
    assert.ok(
      flat(queries[0]?.sql)?.endsWith(
        '"g"."agency_id" = $4::uuid) ) and "gv"."version" = $5 order by "gv"."version" desc limit $6'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['g1', 'workflow', true, 't-1', 2, 1]);
  });
});

describe('run lookups', () => {
  it('opens a run with its inputs, result, error, state and wait key within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r1' }]);
    assert.deepEqual(await findRun(db, 't-1', 'r1'), { id: 'r1' });
    assert.equal(
      queries[0]?.sql,
      `${RUN_COLUMNS}, "r"."inputs", "r"."result", "r"."error", "r"."state", "r"."wait_key", ( select jsonb_build_object('id', e.id, 'type', e.type, 'createdAt', e.created_at) from event_runs er join events e on e.id = er.event_id where er.run_id = r.id ) as "event" ${RUN_FROM} where "r"."agency_id" = $1 and "r"."id" = $2`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'r1']);
  });

  it('reads only the status of a run within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ status: 'running' }]);
    assert.deepEqual(await findRunStatus(db, 't-1', 'r1'), { status: 'running' });
    assert.equal(
      queries[0]?.sql,
      'select "status" from "workflow_runs" where "agency_id" = $1 and "id" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'r1']);
  });
});

describe('run details', () => {
  it('lists up to 200 children of a run in spawn order', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'c1' }]);
    assert.deepEqual(await listChildren(db, 'r1'), [{ id: 'c1' }]);
    assert.equal(
      queries[0]?.sql,
      `${RUN_COLUMNS} ${RUN_FROM} where "r"."parent_id" = $1 order by "r"."parent_index" limit $2`
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', 200]);
  });

  it('counts every child of a run as a number', async () => {
    const { db, queries } = createRecordingDb(() => [{ count: '7' }]);
    assert.equal(await countChildren(db, 'r1'), 7);
    assert.equal(
      queries[0]?.sql,
      'select count(*) as "count" from "workflow_runs" where "parent_id" = $1'
    );
    assert.deepEqual(queries[0]?.parameters, ['r1']);
  });

  it('lists up to 200 tasks of a run newest first', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'k1' }]);
    assert.deepEqual(await listRunTasks(db, 'r1'), [{ id: 'k1' }]);
    assert.equal(
      queries[0]?.sql,
      'select "id", "kind", "queue", "title", "status", "outcomes", "created_at", "completed_at" from "tasks" where "run_id" = $1 order by "created_at" desc limit $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', 200]);
  });

  it('walks up to 32 ancestors of a run, root first', async () => {
    const parent = { id: 'p1', name: 'Ingest', status: 'running' };
    const { db, queries } = createRecordingDb(() => [parent]);
    assert.deepEqual(await listAncestors(db, 'r1'), [parent]);
    assert.equal(
      flat(queries[0]?.sql),
      'with recursive chain (id, parent_id, depth) as ( select id, parent_id, 0 from workflow_runs where id = $1 union all select w.id, w.parent_id, c.depth + 1 from workflow_runs w join chain c on w.id = c.parent_id where c.depth < $2 ) select c.id, g.name, r.status from chain c join workflow_runs r on r.id = c.id join graph_versions gv on gv.id = r.graph_version_id join graphs g on g.id = gv.graph_id where c.depth > 0 order by c.depth desc'
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', 32]);
  });
});

describe('listSteps', () => {
  const STEPS =
    'select "seq", "scope", "path", "node", "node_type", "node_version", "event", "inputs", "outputs", "pin", "error", "started_at", "duration_ms" from "workflow_run_steps" where "run_id" = $1 and "seq" > $2';

  it('pages steps by sequence after a cursor', async () => {
    const { db, queries } = createRecordingDb(() => [{ seq: 1 }]);
    assert.deepEqual(await listSteps(db, 'r1', { after: 0, limit: 500 }), [{ seq: 1 }]);
    assert.equal(queries[0]?.sql, `${STEPS} order by "seq" limit $3`);
    assert.deepEqual(queries[0]?.parameters, ['r1', 0, 500]);
  });

  it('narrows to a node path and node', async () => {
    const { db, queries } = createRecordingDb();
    await listSteps(db, 'r1', { path: 'sub/', node: 'n1', after: 5, limit: 100 });
    assert.equal(
      queries[0]?.sql,
      `${STEPS} and "path" = $3 and "node" = $4 order by "seq" limit $5`
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', 5, 'sub/', 'n1', 100]);
  });

  it('narrows to the top-level path when it is empty', async () => {
    const { db, queries } = createRecordingDb();
    await listSteps(db, 'r1', { path: '', after: 0, limit: 10 });
    assert.equal(queries[0]?.sql, `${STEPS} and "path" = $3 order by "seq" limit $4`);
    assert.deepEqual(queries[0]?.parameters, ['r1', 0, '', 10]);
  });
});
