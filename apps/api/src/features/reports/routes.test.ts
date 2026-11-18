import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createReportRoutes } from './routes.ts';
import type { ReportService } from './service.ts';

describe('report routes', () => {
  it('run the remittance report for a period, and refuse a period that ends before it starts', async () => {
    const calls: unknown[][] = [];
    const request = withSession(
      createReportRoutes({
        remittances: async (...args: unknown[]) => {
          calls.push(args);
          return ok({ remittances: [] });
        }
      } as unknown as ReportService)
    );
    assert.equal(
      (await request('/remittances?from=2026-11-01&to=2026-11-30&payer=blue')).status,
      200
    );
    assert.equal((await request('/remittances')).status, 200);
    assert.equal((await request('/remittances?from=2026-12-01&to=2026-11-01')).status, 400);
    assert.equal((await request('/remittances?from=yesterday')).status, 400);
    assert.deepEqual(calls, [
      ['t-1', { from: '2026-11-01', to: '2026-11-30', payer: 'blue' }],
      ['t-1', {}]
    ]);
  });
});
