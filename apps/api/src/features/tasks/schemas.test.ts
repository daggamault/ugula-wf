import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { completeTaskSchema, nextTaskSchema, searchTasksQuery, taskFileSchema } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

describe('nextTaskSchema', () => {
  it('takes the next task from any queue by default', () => {
    assert.deepEqual(v.parse(nextTaskSchema, {}), { queue: null });
    assert.deepEqual(v.parse(nextTaskSchema, { queue: null }), { queue: null });
  });

  it('takes a named queue of 1 to 60 characters', () => {
    assert.deepEqual(v.parse(nextTaskSchema, { queue: 'coding' }), { queue: 'coding' });
    assert.deepEqual(issues(nextTaskSchema, { queue: '' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues(nextTaskSchema, { queue: 'x'.repeat(61) }), [
      'Invalid length: Expected <=60 but received 61'
    ]);
  });
});

describe('completeTaskSchema', () => {
  it('completes with an outcome and no values by default', () => {
    assert.deepEqual(v.parse(completeTaskSchema, { outcome: 'ok' }), {
      outcome: 'ok',
      values: {},
      note: ''
    });
  });

  it('keeps the values entered', () => {
    assert.deepEqual(v.parse(completeTaskSchema, { outcome: 'ok', values: { note: 'x' } }), {
      outcome: 'ok',
      values: { note: 'x' },
      note: ''
    });
  });

  it('keeps a trimmed note of up to 1000 characters for the claim history', () => {
    assert.equal(
      v.parse(completeTaskSchema, { outcome: 'ok', note: ' Called the PSAP ' }).note,
      'Called the PSAP'
    );
    assert.equal(
      v.safeParse(completeTaskSchema, { outcome: 'ok', note: 'x'.repeat(1001) }).success,
      false
    );
  });

  it('needs an outcome of 1 to 200 characters', () => {
    assert.deepEqual(issues(completeTaskSchema, { outcome: '' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues(completeTaskSchema, { outcome: 'x'.repeat(201) }), [
      'Invalid length: Expected <=200 but received 201'
    ]);
  });
});

describe('searchTasksQuery', () => {
  it('lists tasks for everyone, longest waiting first, by default', () => {
    assert.deepEqual(v.parse(searchTasksQuery, {}), {
      assignee: 'all',
      page: 1,
      pageSize: 25,
      sort: 'waiting',
      dir: 'asc'
    });
  });

  it('narrows by search text, queue, assignee and run', () => {
    assert.deepEqual(
      v.parse(searchTasksQuery, {
        q: ' Doe ',
        queue: 'coding',
        assignee: 'mine',
        runId: ID,
        sort: 'assignee'
      }),
      {
        q: 'Doe',
        queue: 'coding',
        assignee: 'mine',
        runId: ID,
        page: 1,
        pageSize: 25,
        sort: 'assignee',
        dir: 'asc'
      }
    );
  });

  it('rejects unknown assignees and sorts, blank or long queues and bad run ids', () => {
    for (const bad of [
      { assignee: 'x' },
      { queue: '' },
      { sort: 'x' },
      { queue: 'q'.repeat(61) },
      { runId: 'r1' }
    ]) {
      assert.equal(v.safeParse(searchTasksQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('taskFileSchema', () => {
  it('needs an uploaded file', () => {
    const file = new File(['x'], 'a.pdf');
    assert.equal(v.parse(taskFileSchema, { file }).file, file);
    assert.equal(v.safeParse(taskFileSchema, {}).success, false);
  });
});
