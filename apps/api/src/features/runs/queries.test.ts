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
  listRuns,
  listRunTasks,
  listSteps
} from './queries.ts';

describe('run queries', () => {
  it('filter run lists and scope everything by tenant', async () => {
    const { db, queries } = createRecordingDb();
    await listRuns(db, 't-1', {
      status: 'faulted',
      graphId: 'g1',
      rootOnly: true,
      page: 1,
      pageSize: 10,
      sort: 'workflow',
      dir: 'asc'
    });
    await findRun(db, 't-1', 'r1');
    await listRuns(db, 't-1', {
      q: ' Ingest%',
      rootOnly: false,
      page: 1,
      pageSize: 10,
      sort: 'started',
      dir: 'desc'
    });
    const [list, find, search] = queries;
    assert.ok(list?.sql.includes('"r"."parent_id" is null'));
    assert.deepEqual(list?.parameters, ['t-1', 'faulted', 'g1', 10, 0]);
    assert.ok(list?.sql.includes('order by lower(g.name) asc nulls last, "r"."id" asc'));
    assert.ok(find?.sql.includes('"r"."state"'));
    assert.ok(search?.sql.includes('(lower(g.name) like $2 or lower(g.key) like $3'));
    assert.deepEqual(search?.parameters.slice(0, 2), ['t-1', '%ingest\\%%']);
    await db.destroy();
  });

  it('page steps by sequence and narrow to a node path', async () => {
    const { db, queries } = createRecordingDb();
    await listSteps(db, 'r1', { path: 'sub/', node: 'n1', after: 5, limit: 100 });
    assert.ok(queries[0]?.sql.includes('order by "seq"'));
    assert.deepEqual(queries[0]?.parameters, ['r1', 5, 'sub/', 'n1', 100]);
    await db.destroy();
  });

  it('pick the newest published version of an active workflow unless one is requested', async () => {
    const { db, queries } = createRecordingDb();
    await findPublishedVersion(db, 't', 'g');
    await findPublishedVersion(db, 't', 'g', 3);
    assert.ok(queries[0]?.sql.includes('"g"."kind" = $2 and "g"."is_active" = $3'));
    assert.deepEqual(queries[0]?.parameters.slice(0, 3), ['g', 'workflow', true]);
    assert.ok(!queries[0]?.sql.includes('"gv"."version" = $'));
    assert.ok(queries[1]?.sql.includes('"gv"."version" = $'));
    await db.destroy();
  });
});

describe('run tenant scoping', () => {
  it('start only system workflows or those of the tenant', async () => {
    const { db, queries } = createRecordingDb();
    await findPublishedVersion(db, 't-1', 'g1', 2);
    assert.ok(queries[0]?.sql.includes('("g"."tenant_id" = $4 or "g"."tenant_id" is null)'));
    assert.deepEqual(queries[0]?.parameters, ['g1', 'workflow', true, 't-1', 2, 1]);
    await db.destroy();
  });

  it('open a run by id within the tenant', async () => {
    const { db, queries } = createRecordingDb();
    await findRun(db, 't-1', 'r1');
    assert.ok(queries[0]?.sql.endsWith('where "r"."tenant_id" = $1 and "r"."id" = $2'));
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'r1']);
    await db.destroy();
  });

  it('reads only the status of a run within the tenant', async () => {
    const { db, queries } = createRecordingDb();
    await findRunStatus(db, 't-1', 'r1');
    assert.equal(
      queries[0]?.sql,
      'select "status" from "workflow_runs" where "tenant_id" = $1 and "id" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'r1']);
    await db.destroy();
  });

  it('read children, tasks and ancestors of one run with bounded results', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('count(*)') ? [{ count: '7' }] : []
    );
    await listChildren(db, 'r1');
    assert.equal(await countChildren(db, 'r1'), 7);
    await listRunTasks(db, 'r1');
    await listAncestors(db, 'r1');
    const [children, count, tasks, ancestors] = queries;
    assert.ok(
      children?.sql.endsWith('where "r"."parent_id" = $1 order by "r"."parent_index" limit $2')
    );
    assert.deepEqual(children?.parameters, ['r1', 200]);
    assert.deepEqual(count?.parameters, ['r1']);
    assert.ok(tasks?.sql.endsWith('where "run_id" = $1 order by "created_at" desc limit $2'));
    assert.ok(ancestors?.sql.includes('where c.depth < $2'));
    assert.deepEqual(ancestors?.parameters, ['r1', 32]);
    await db.destroy();
  });

  it('read steps from the start without narrowing', async () => {
    const { db, queries } = createRecordingDb();
    await listSteps(db, 'r1', { after: 0, limit: 500 });
    assert.ok(!queries[0]?.sql.includes('"path" = $'));
    assert.ok(!queries[0]?.sql.includes('"node" = $'));
    assert.deepEqual(queries[0]?.parameters, ['r1', 0, 500]);
    await db.destroy();
  });
});
