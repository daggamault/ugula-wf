import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createReportRoutes } from './routes.ts';
import type { ReportService } from './service.ts';

const calls: unknown[][] = [];

const service = {
  run: async (...args: unknown[]) => {
    calls.push(args);
    return ok({ items: [], total: 0, page: 1, pageSize: 100, totals: {} });
  }
} as unknown as ReportService;

const request = withSession(createReportRoutes(service));

describe('report routes', () => {
  it('runs the named report for the session agency with its options and page', async () => {
    assert.equal((await request('/aging?page=2&group=class&tz=America/Chicago')).status, 200);
    assert.equal((await request('/monthly?from=2026-01-01&to=2026-06-30')).status, 200);
    assert.equal((await request('/write-offs?all=true')).status, 200);
    assert.deepEqual(calls, [
      ['t-1', 'aging', { tz: 'America/Chicago', group: 'class', page: 2 }],
      ['t-1', 'monthly', { from: '2026-01-01', to: '2026-06-30', tz: 'UTC', page: 1 }],
      ['t-1', 'write-offs', { tz: 'UTC', page: 'all' }]
    ]);
  });

  it('rejects malformed options', async () => {
    assert.equal((await request('/monthly?from=june')).status, 400);
    assert.equal((await request('/hcpcs?from=2026-02-01&to=2026-01-01')).status, 400);
    assert.equal((await request('/aging?page=0')).status, 400);
    assert.equal((await request('/aging?all=yes')).status, 400);
    assert.equal((await request('/aging?tz=Mars/Base')).status, 400);
    assert.equal((await request('/Aging')).status, 400);
  });
});

describe('report route failures', () => {
  it('maps unknown reports to 404 and groups a report lacks to 422', async () => {
    const failing = withSession(
      createReportRoutes({
        run: async (_agencyId: string, id: string) =>
          id === 'nope'
            ? fail('not_found', 'There is no report called “nope”.')
            : fail('invalid', 'This report can’t be grouped by “queue”.')
      } as unknown as ReportService)
    );
    const missing = await failing('/nope');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'There is no report called “nope”.' });
    assert.equal((await failing('/aging?group=queue')).status, 422);
  });
});
