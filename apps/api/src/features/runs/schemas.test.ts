import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { listRunsQuery, signalSchema, startRunSchema, stepsQuery } from './schemas.ts';

const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('run schemas', () => {
  it('apply defaults', () => {
    assert.deepEqual(v.parse(startRunSchema, { graphId: id }), { graphId: id, inputs: {} });
    assert.deepEqual(v.parse(listRunsQuery, {}), {
      root: 'true',
      page: 1,
      pageSize: 25,
      sort: 'started',
      dir: 'desc'
    });
    assert.deepEqual(v.parse(stepsQuery, {}), { after: 0, limit: 500 });
    assert.deepEqual(v.parse(signalSchema, { name: 'a', key: 'b' }), {
      name: 'a',
      key: 'b',
      payload: null
    });
  });

  it('reject bad input', () => {
    assert.equal(v.safeParse(startRunSchema, { graphId: 'x' }).success, false);
    assert.equal(v.safeParse(startRunSchema, { graphId: id, version: 0 }).success, false);
    assert.equal(v.safeParse(listRunsQuery, { status: 'odd' }).success, false);
  });
});
