import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createReportsClient } from './client.ts';

describe('createReportsClient', () => {
  it('requests each report, passing the period where it applies', async () => {
    const seen: string[] = [];
    const client = createReportsClient(
      createApi('http://api.test', async (url) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      })
    );
    const range = { from: '2026-01-01', to: '2026-06-30' };
    await client.aging();
    await client.monthly(range);
    await client.hcpcs(range);
    await client.payers(range);
    assert.deepEqual(seen, [
      'http://api.test/api/reports/aging',
      'http://api.test/api/reports/monthly?from=2026-01-01&to=2026-06-30',
      'http://api.test/api/reports/hcpcs?from=2026-01-01&to=2026-06-30',
      'http://api.test/api/reports/payers?from=2026-01-01&to=2026-06-30'
    ]);
  });
});
