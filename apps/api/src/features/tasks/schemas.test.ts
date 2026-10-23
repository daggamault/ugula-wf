import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { completeTaskSchema, listTasksQuery, nextTaskSchema } from './schemas.ts';

describe('task schemas', () => {
  it('apply defaults and require queues and outcomes', () => {
    assert.deepEqual(v.parse(listTasksQuery, {}), { status: 'open', mine: 'false', limit: 50 });
    assert.deepEqual(v.parse(completeTaskSchema, { outcome: 'ok' }), { outcome: 'ok', values: {} });
    assert.equal(v.safeParse(nextTaskSchema, { queue: '' }).success, false);
    assert.equal(v.safeParse(completeTaskSchema, { outcome: '' }).success, false);
  });
});
