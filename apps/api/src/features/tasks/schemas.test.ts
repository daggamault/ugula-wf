import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { completeTaskSchema, nextTaskSchema } from './schemas.ts';

describe('task schemas', () => {
  it('apply defaults and require queues and outcomes', () => {
    assert.deepEqual(v.parse(completeTaskSchema, { outcome: 'ok' }), { outcome: 'ok', values: {} });
    assert.equal(v.safeParse(nextTaskSchema, { queue: '' }).success, false);
    assert.deepEqual(v.parse(nextTaskSchema, {}), { queue: null });
    assert.equal(v.safeParse(completeTaskSchema, { outcome: '' }).success, false);
    assert.equal(v.safeParse(nextTaskSchema, { queue: 'x'.repeat(61) }).success, false);
    assert.equal(v.safeParse(completeTaskSchema, { outcome: 'x'.repeat(201) }).success, false);
  });
});
