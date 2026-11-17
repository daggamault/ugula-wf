import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createPeriodsClient } from './client.ts';

describe('createPeriodsClient', () => {
  it('lists closed periods with the page query and passes the abort signal on', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const calls: unknown[][] = [];
    const api = {
      get: async (...args: unknown[]) => {
        calls.push(args);
        return page;
      }
    } as unknown as Api;
    const signal = new AbortController().signal;
    assert.equal(await createPeriodsClient(api).search('page=2', signal), page);
    assert.deepEqual(calls, [['/api/periods?page=2', signal]]);
  });
});
