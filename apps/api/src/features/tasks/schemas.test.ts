import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { completeTaskSchema, listTasksQuery, nextTaskSchema } from './schemas.ts';

describe('task schemas', () => {
  it('apply defaults and require queues and outcomes', () => {
    assert.deepEqual(v.parse(completeTaskSchema, { outcome: 'ok' }), { outcome: 'ok', values: {} });
    assert.equal(v.safeParse(nextTaskSchema, { queue: '' }).success, false);
    assert.deepEqual(v.parse(nextTaskSchema, {}), { queue: null });
    assert.equal(v.safeParse(completeTaskSchema, { outcome: '' }).success, false);
    assert.equal(v.safeParse(nextTaskSchema, { queue: 'x'.repeat(61) }).success, false);
    assert.equal(v.safeParse(completeTaskSchema, { outcome: 'x'.repeat(201) }).success, false);
  });

  it('list tasks for everyone, oldest first, unless told otherwise', () => {
    assert.deepEqual(v.parse(listTasksQuery, {}), {
      assignee: 'all',
      page: 1,
      pageSize: 25,
      sort: 'waiting',
      dir: 'asc'
    });
    assert.deepEqual(v.parse(listTasksQuery, { q: ' Doe ', sort: 'assignee' }), {
      q: 'Doe',
      assignee: 'all',
      page: 1,
      pageSize: 25,
      sort: 'assignee',
      dir: 'asc'
    });
    for (const bad of [
      { assignee: 'x' },
      { queue: '' },
      { sort: 'x' },
      { queue: 'q'.repeat(61) }
    ]) {
      assert.equal(v.safeParse(listTasksQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});
