import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReportsClient, reportQuery } from './client.ts';

describe('reportQuery', () => {
  it('keeps only the report fields that are set', () => {
    assert.equal(
      reportQuery(new URLSearchParams('from=2026-11-01&to=&payer=+blue+&page=2')),
      'from=2026-11-01&payer=blue'
    );
  });
});

describe('createReportsClient', () => {
  it('runs the remittance report', async () => {
    const paths: string[] = [];
    const client = createReportsClient({
      get: async (path: string) => {
        paths.push(path);
        return {};
      }
    } as never);
    await client.remittances('from=2026-11-01');
    assert.deepEqual(paths, ['/api/reports/remittances?from=2026-11-01']);
  });
});
