import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  assignTask,
  claimNext,
  completeTask,
  findTask,
  findTaskSource,
  listQueues,
  searchTasks
} from './queries.ts';

describe('task queries', () => {
  it('summarize open work per queue and find one task in its agency', async () => {
    const { db, queries } = createRecordingDb();
    await listQueues(db, 't', 'u1');
    await findTask(db, 't', 'x');
    assert.ok(queries[0]?.sql.includes('filter (where assignee_id is null)'));
    assert.deepEqual(queries[1]?.parameters, ['t', 'x']);
    await db.destroy();
  });

  it('claim, assign and complete only open tasks', async () => {
    const { db, queries } = createRecordingDb();
    await claimNext(db, 't', 'billing', 'u1', []);
    await assignTask(db, { agencyId: 't', id: 'x', userId: 'u1', assignee: null });
    await claimNext(db, 't', null, 'u1', []);
    await completeTask(db, { agencyId: 't', id: 'x', userId: 'u1', resolution: { outcome: 'ok' } });
    assert.ok(queries[0]?.sql.includes('("assignee_id" is null or "assignee_id" = $'));
    assert.ok(queries[0]?.sql.includes('order by assignee_id is null'));
    assert.ok(queries[0]?.sql.includes('for update skip locked'));
    for (const q of queries.slice(1)) assert.ok(q.sql.includes('"status" = $'));
    assert.ok(!queries[2]?.sql.includes('"queue" = $'));
    assert.ok(queries[3]?.parameters.includes('{"outcome":"ok"}'));
    for (const q of [queries[1], queries[3]]) {
      assert.ok(q?.sql.includes('("assignee_id" is null or "assignee_id" = $'));
      assert.ok(q?.parameters.includes('u1'));
    }
    await db.destroy();
  });
});

describe('task list', () => {
  const page = {
    page: 1,
    pageSize: 25,
    sort: 'waiting',
    dir: 'asc',
    queue: [],
    assignee: []
  } as const;

  const isFacet = (text: string) => text.includes('group by 1');

  it('lists open tasks of the agency with their claim and patient, oldest first', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql)
        ? q.sql.includes('coalesce(t.assignee_id::text')
          ? [
              { value: 'u1', label: 'a@b.c', count: '2' },
              { value: 'none', label: null, count: '1' }
            ]
          : [{ value: 'billing', label: null, count: '3' }]
        : []
    );
    const result = await searchTasks(db, 't-1', page);
    assert.deepEqual(result.facets, {
      queue: [{ value: 'billing', count: 3 }],
      assignee: [
        { value: 'u1', label: 'a@b.c', count: 2 },
        { value: 'none', count: 1 }
      ]
    });
    const [list, queues, assignees] = queries;
    assert.ok(list?.sql.includes('left join "users" as "u" on "u"."id" = "t"."assignee_id"'));
    assert.ok(list?.sql.includes('left join "claims" as "c" on "c"."id" = "cr"."claim_id"'));
    assert.ok(list?.sql.includes('"c"."number" as "claim_number"'));
    assert.ok(list?.sql.includes('where "t"."agency_id" = $1 and "t"."status" = $2 order by'));
    assert.ok(list?.sql.includes('order by "t"."created_at" asc nulls last, "t"."id" asc'));
    assert.ok(!list?.sql.includes(' in ('));
    assert.deepEqual(list?.parameters, ['t-1', 'open', 25, 0]);
    assert.ok(queues?.sql.startsWith('select "t"."queue"::text as "value", null as "label"'));
    assert.ok(
      assignees?.sql.startsWith(
        `select coalesce(t.assignee_id::text, 'none')::text as "value", min("u"."email"::text) as "label"`
      )
    );
    await db.destroy();
  });

  it('filters by queues, run and assignees, counting each facet without its own filter', async () => {
    const { db, queries } = createRecordingDb();
    await searchTasks(db, 't-1', {
      ...page,
      queue: ['billing'],
      assignee: ['u1', 'none'],
      sort: 'assignee'
    });
    const [list, queues, assignees] = queries;
    assert.ok(
      list?.sql.includes(
        `"t"."queue" in ($3) and coalesce(t.assignee_id::text, 'none') in ($4, $5) order by "u"."email" asc nulls last`
      )
    );
    assert.deepEqual(list?.parameters.slice(0, 5), ['t-1', 'open', 'billing', 'u1', 'none']);
    assert.ok(queues?.sql.includes(`coalesce(t.assignee_id::text, 'none') in ($3, $4)`));
    assert.ok(!queues?.sql.includes('"t"."queue" in'));
    assert.ok(assignees?.sql.includes('"t"."queue" in ($3)'));
    assert.ok(!assignees?.sql.includes(`'none') in`));
    queries.length = 0;
    await searchTasks(db, 't-1', { ...page, runId: 'r1' });
    assert.ok(
      queries[0]?.sql.includes(
        'where "t"."agency_id" = $1 and "t"."status" = $2 and "t"."run_id" = $3 order by'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'open', 'r1', 25, 0]);
    await db.destroy();
  });

  it('searches titles, subjects, patients, PCRs and claim numbers', async () => {
    const { db, queries } = createRecordingDb();
    await searchTasks(db, 't-1', { ...page, q: ' #202611050007 ' });
    const [byNumber] = queries;
    queries.length = 0;
    await searchTasks(db, 't-1', { ...page, q: '50%' });
    const [byText] = queries;
    assert.ok(
      byNumber?.sql.includes(
        '(lower(t.title) like $3 or lower(t.subject) like $4 or lower(p.last_name || \', \' || p.first_name) like $5 or "c"."pcr_number" = $6 or "c"."number" = $7)'
      )
    );
    assert.deepEqual(byNumber?.parameters.slice(2, 7), [
      '%#202611050007%',
      '%#202611050007%',
      '%#202611050007%',
      '#202611050007',
      '20261105-0007'
    ]);
    assert.ok(!byText?.sql.includes('"c"."number" ='));
    assert.deepEqual(byText?.parameters.slice(2, 6), ['%50\\%%', '%50\\%%', '%50\\%%', '50%']);
    await db.destroy();
  });
});

describe('task agency scoping', () => {
  it('count, hand out and assign only open tasks of the agency', async () => {
    const { db, queries } = createRecordingDb();
    await listQueues(db, 't-1', 'u1');
    await claimNext(db, 't-1', 'billing', 'u1', []);
    await assignTask(db, { agencyId: 't-1', id: 'x', userId: 'u1', assignee: 'u1' });
    await completeTask(db, { agencyId: 't-1', id: 'x', userId: 'u1', resolution: {} });
    const [queues, next, assign, complete] = queries;
    assert.ok(queues?.sql.includes('where "agency_id" = $2 and "status" = $3 group by "queue"'));
    assert.deepEqual(queues?.parameters, ['u1', 't-1', 'open']);
    assert.ok(next?.sql.includes('(select "id" from "tasks" where "agency_id" = $2'));
    assert.deepEqual(next?.parameters, ['u1', 't-1', 'open', 'billing', 'u1', [], 1]);
    assert.deepEqual(assign?.parameters, ['u1', 't-1', 'x', 'open', 'u1']);
    assert.ok(complete?.sql.includes('where "agency_id" = $'));
    assert.ok(complete?.parameters.includes('t-1'));
    await db.destroy();
  });

  it('trace a task run back to its report and claim', async () => {
    const { db, queries } = createRecordingDb();
    await findTaskSource(db, 'r1');
    assert.ok(queries[0]?.sql.endsWith('where "r"."id" = $1'));
    assert.deepEqual(queries[0]?.parameters, ['r1']);
    await db.destroy();
  });
});
