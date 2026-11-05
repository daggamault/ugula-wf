import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { cancelTasks, insertTask, type TaskInsert, taskNotification } from './run-tasks.ts';

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
    const fault = taskNotification({ ...task, kind: 'fault', title: 'Stuck at Price' }, 'k2');
    assert.equal(fault.intent, 'danger');
    assert.equal(fault.title, 'Stuck run: Stuck at Price');
  });
});

describe('insertTask', () => {
  it('upserts tasks idempotently and announces only new ones', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await insertTask(db, { ...task, subject: 'PCR-1' });
    assert.ok(
      queries[0]?.sql.includes('on conflict ("run_id", "wait_id") do nothing returning "id"')
    );
    assert.equal(queries.length, 1);
    await db.destroy();
  });

  it('assigns tasks only to agency members and links the notification to the task', async () => {
    const { db, queries } = insertedDb();
    await insertTask(db, {
      ...task,
      assigneeId: 'u1',
      dueAt: '2026-12-01T00:00:00.000Z',
      permission: 'claims:approve'
    });
    const inserted = queries.find((q) => q.sql.startsWith('insert into "tasks"'));
    assert.ok(
      inserted?.sql.includes('(select "user_id" from "memberships" where user_id::text = $')
    );
    assert.ok(inserted?.parameters.includes('u1'));
    assert.ok(inserted?.parameters.includes('2026-12-01T00:00:00.000Z'));
    const note = queries.find((q) => q.sql.startsWith('insert into "notifications"'));
    assert.ok(note?.parameters.includes('/tasks/new-1'));
    await db.destroy();
  });

  it('makes a date-only due date the end of that day in the agency time zone', async () => {
    const { db, queries } = insertedDb();
    await insertTask(db, { ...task, dueAt: '2026-11-10' });
    const inserted = queries.find((q) => q.sql.startsWith('insert into "tasks"'));
    assert.ok(
      inserted?.sql.includes(
        "::date + interval '1 day' - interval '1 second') at time zone coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = $"
      )
    );
    assert.ok(inserted?.parameters.includes('2026-11-10'));
    await db.destroy();
  });
});

describe('cancelTasks', () => {
  it('cancels only open tasks of the run', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await cancelTasks(db, 'r1');
    assert.ok(queries[0]?.sql.startsWith('update "tasks" set "status" = $1'));
    assert.deepEqual(queries[0]?.parameters, ['cancelled', 'r1', 'open']);
    await db.destroy();
  });
});
