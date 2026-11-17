import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { cancelTasks, insertTask, type TaskInsert, taskNotification } from './run-tasks.ts';

const USER = '0195f2a4-0000-7000-8000-0000000000a1';

const task: TaskInsert = {
  agencyId: 't',
  runId: 'r',
  waitId: '7',
  kind: 'task',
  queue: 'q',
  title: 'T',
  subject: null,
  summary: null,
  instructions: '',
  context: null,
  fields: [],
  outcomes: ['ok'],
  defaults: null,
  priority: 0,
  assigneeId: null,
  dueAt: null,
  permission: null
};

const COLUMNS =
  'insert into "tasks" ("agency_id", "run_id", "wait_id", "kind", "queue", "title", "subject", "summary", "instructions", "context", "fields", "outcomes", "hints", "defaults", "prefill", "priority", "due_at", "permission", "assignee_id") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ';

const UPSERT = ' on conflict ("run_id", "wait_id") do nothing returning "id"';

const insertedDb = () =>
  createRecordingDb((q) => (q.sql.startsWith('insert into "tasks"') ? [{ id: 'new-1' }] : []));

describe('taskNotification', () => {
  it('announces new tasks and stuck runs with a link to the task', () => {
    const task = { agencyId: 't', kind: 'task' as const, title: 'Review PCR', subject: 'PCR-1' };
    assert.deepEqual(taskNotification(task, 'k1'), {
      agency_id: 't',
      intent: 'info',
      title: 'New task: Review PCR',
      description: 'PCR-1',
      link_label: 'Open task',
      link_to: '/tasks/k1'
    });
    assert.deepEqual(taskNotification({ ...task, kind: 'fault', title: 'Stuck at Price' }, 'k2'), {
      agency_id: 't',
      intent: 'danger',
      title: 'Stuck run: Stuck at Price',
      description: 'PCR-1',
      link_label: 'Open task',
      link_to: '/tasks/k2'
    });
  });
});

describe('insertTask', () => {
  it('inserts a task once per run wait and announces nothing when it already exists', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await insertTask(db, {
      ...task,
      subject: 'PCR-1',
      summary: 'S',
      instructions: 'Do it',
      context: { claim: 'c1' },
      fields: [{ name: 'note' }],
      hints: { ok: 'Fine' },
      defaults: { note: '' },
      prefill: 'current',
      priority: 2,
      permission: 'claims:approve'
    });
    assert.deepEqual(
      queries.map((q) => ({ sql: q.sql, parameters: q.parameters })),
      [
        {
          sql: `${COLUMNS}$17, $18, $19)${UPSERT}`,
          parameters: [
            't',
            'r',
            '7',
            'task',
            'q',
            'T',
            'PCR-1',
            'S',
            'Do it',
            '{"claim":"c1"}',
            '[{"name":"note"}]',
            ['ok'],
            '{"ok":"Fine"}',
            '{"note":""}',
            'current',
            2,
            null,
            'claims:approve',
            null
          ]
        }
      ]
    );
    await db.destroy();
  });

  it('announces a newly inserted task with a link to it', async () => {
    const { db, queries } = insertedDb();
    await insertTask(db, { ...task, subject: 'PCR-1' });
    assert.equal(queries.length, 2);
    assert.equal(
      queries[1]?.sql,
      'insert into "notifications" ("agency_id", "intent", "title", "description", "link_label", "link_to") values ($1, $2, $3, $4, $5, $6)'
    );
    assert.deepEqual(queries[1]?.parameters, [
      't',
      'info',
      'New task: T',
      'PCR-1',
      'Open task',
      '/tasks/new-1'
    ]);
    await db.destroy();
  });

  it('assigns a task only to a member of its agency and stores a timestamp due date as given', async () => {
    const { db, queries } = insertedDb();
    await insertTask(db, { ...task, assigneeId: USER, dueAt: '2026-12-01T00:00:00.000Z' });
    assert.equal(
      queries[0]?.sql,
      `${COLUMNS}$17, $18, (select "user_id" from "memberships" where "agency_id" = $19 and "user_id" = $20))${UPSERT}`
    );
    assert.deepEqual(queries[0]?.parameters.slice(12), [
      '{}',
      'null',
      null,
      0,
      '2026-12-01T00:00:00.000Z',
      null,
      't',
      USER
    ]);
    await db.destroy();
  });

  it('leaves a task unassigned when the assignee is not a user id', async () => {
    const { db, queries } = insertedDb();
    await insertTask(db, { ...task, assigneeId: 'u1' });
    assert.equal(queries[0]?.sql, `${COLUMNS}$17, $18, $19)${UPSERT}`);
    assert.equal(queries[0]?.parameters.at(-1), null);
    await db.destroy();
  });

  it('makes a date-only due date the end of that day in the agency time zone', async () => {
    const { db, queries } = insertedDb();
    await insertTask(db, { ...task, dueAt: '2026-11-10' });
    assert.equal(
      queries[0]?.sql,
      `${COLUMNS}($17::date + interval '1 day' - interval '1 second') at time zone coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = $18::uuid), 'UTC'), $19, $20)${UPSERT}`
    );
    assert.deepEqual(queries[0]?.parameters.slice(16), ['2026-11-10', 't', null, null]);
    await db.destroy();
  });
});

describe('cancelTasks', () => {
  it('cancels only open tasks of the run', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await cancelTasks(db, 'r1');
    assert.equal(
      queries[0]?.sql,
      'update "tasks" set "status" = $1, "updated_at" = now() where "run_id" = $2 and "status" = $3'
    );
    assert.deepEqual(queries[0]?.parameters, ['cancelled', 'r1', 'open']);
    await db.destroy();
  });
});
