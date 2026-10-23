import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { rangeQuery } from './schemas.ts';

describe('rangeQuery', () => {
  it('accepts an optional, ordered pair of dates', () => {
    assert.deepEqual(v.parse(rangeQuery, {}), {});
    assert.deepEqual(v.parse(rangeQuery, { from: '2026-01-01', to: '2026-01-31' }), {
      from: '2026-01-01',
      to: '2026-01-31'
    });
    assert.equal(v.safeParse(rangeQuery, { from: '2026-02-01', to: '2026-01-31' }).success, false);
    assert.equal(v.safeParse(rangeQuery, { from: '01/01/2026' }).success, false);
  });
});
