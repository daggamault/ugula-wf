import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createPeriodRoutes } from './routes.ts';
import type { PeriodService } from './service.ts';

describe('period routes', () => {
  it('pages the closed periods of the session agency', async () => {
    const calls: unknown[][] = [];
    const service = {
      search: async (...args: unknown[]) => {
        calls.push(args);
        return ok({ items: [], total: 0, page: 2, pageSize: 10 });
      }
    } as unknown as PeriodService;
    const request = withSession(createPeriodRoutes(service));
    assert.equal((await request('/?page=2&pageSize=10')).status, 200);
    assert.equal((await request('/?sort=closed')).status, 400);
    assert.deepEqual(calls, [['t-1', { page: 2, pageSize: 10, sort: 'period', dir: 'desc' }]]);
  });
});
