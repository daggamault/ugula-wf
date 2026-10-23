import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createReportRoutes } from './routes.ts';
import type { ReportService } from './service.ts';

const calls: unknown[][] = [];

const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok({ rows: [] });
  };

const service = {
  aging: record('aging'),
  monthly: record('monthly'),
  hcpcs: record('hcpcs'),
  payers: record('payers')
} as unknown as ReportService;

const request = withSession(createReportRoutes(service));

describe('report routes', () => {
  it('runs each report for the session tenant with the requested period', async () => {
    assert.equal((await request('/aging')).status, 200);
    assert.equal((await request('/monthly?from=2026-01-01&to=2026-06-30')).status, 200);
    assert.equal((await request('/hcpcs')).status, 200);
    assert.equal((await request('/payers?to=2026-06-30')).status, 200);
    assert.deepEqual(calls, [
      ['aging', 't-1'],
      ['monthly', 't-1', { from: '2026-01-01', to: '2026-06-30' }],
      ['hcpcs', 't-1', {}],
      ['payers', 't-1', { to: '2026-06-30' }]
    ]);
  });

  it('rejects malformed or reversed periods', async () => {
    assert.equal((await request('/monthly?from=june')).status, 400);
    assert.equal((await request('/hcpcs?from=2026-02-01&to=2026-01-01')).status, 400);
  });
});
