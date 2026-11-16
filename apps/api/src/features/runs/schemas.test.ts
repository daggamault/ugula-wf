import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { listStepsQuery, searchRunsQuery, startRunSchema } from './schemas.ts';

const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('run schemas', () => {
  it('apply defaults', () => {
    assert.deepEqual(v.parse(startRunSchema, { graphId: id }), { graphId: id, inputs: {} });
    assert.deepEqual(v.parse(searchRunsQuery, {}), {
      root: 'true',
      page: 1,
      pageSize: 25,
      sort: 'started',
      dir: 'desc'
    });
    assert.deepEqual(v.parse(listStepsQuery, {}), { after: 0, limit: 500 });
  });

  it('reject bad input', () => {
    assert.equal(v.safeParse(startRunSchema, { graphId: 'x' }).success, false);
    assert.equal(v.safeParse(startRunSchema, { graphId: id, version: 0 }).success, false);
    assert.equal(v.safeParse(startRunSchema, { graphId: id, version: 2 ** 31 }).success, false);
    assert.equal(v.safeParse(listStepsQuery, { after: '1e300' }).success, false);
    assert.equal(v.safeParse(searchRunsQuery, { status: 'odd' }).success, false);
    assert.equal(v.safeParse(searchRunsQuery, { q: 'x'.repeat(81) }).success, false);
    assert.equal(v.safeParse(listStepsQuery, { path: 'x'.repeat(201) }).success, false);
    assert.equal(v.safeParse(listStepsQuery, { node: 'x'.repeat(201) }).success, false);
  });
});
