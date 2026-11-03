import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
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
  it('runs the named report for the session tenant with its options and page', async () => {
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
