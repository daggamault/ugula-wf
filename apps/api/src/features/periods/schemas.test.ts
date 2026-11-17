import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { searchPeriodsQuery } from './schemas.ts';

describe('searchPeriodsQuery', () => {
  it('pages the latest period first and sorts only by period', () => {
    assert.deepEqual(v.parse(searchPeriodsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'period',
      dir: 'desc'
    });
    assert.equal(v.safeParse(searchPeriodsQuery, { sort: 'closed' }).success, false);
  });
});
