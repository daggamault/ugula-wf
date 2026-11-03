import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findPublishedVersion, findRun, listRuns, listSteps } from './queries.ts';

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
