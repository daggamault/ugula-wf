import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createReportsClient, reportSearch } from './client.ts';

const range = { from: '2026-01-01', to: '2026-06-30' };

describe('reportSearch', () => {
  it('sends only the options a report uses, the time zone and the page', () => {
    assert.equal(
      reportSearch({ range, group: null }, 1, 'UTC'),
      'from=2026-01-01&to=2026-06-30&tz=UTC'
    );
    assert.equal(
      reportSearch({ range: null, group: 'class' }, 3, 'America/Chicago'),
      'group=class&tz=America%2FChicago&page=3'
    );
    assert.equal(reportSearch({ range: null, group: null }, 'all', 'UTC'), 'tz=UTC&all=true');
  });
});

describe('createReportsClient', () => {
  it('runs a report by id in the browser time zone', async () => {
    const seen: string[] = [];
    const client = createReportsClient(
      createApi('http://api.test', async (url) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
      () => 'America/Denver'
    );
    await client.run('monthly', { range, group: null }, 2);
    await client.run('write-offs', { range, group: null }, 'all');
    assert.deepEqual(seen, [
      'http://api.test/api/reports/monthly?from=2026-01-01&to=2026-06-30&tz=America%2FDenver&page=2',
      'http://api.test/api/reports/write-offs?from=2026-01-01&to=2026-06-30&tz=America%2FDenver&all=true'
    ]);
  });
});

describe('createReportsClient errors', () => {
  it('rejects with the server error and its status', async () => {
    const client = createReportsClient(
      createApi('http://api.test', async () =>
        Response.json({ error: 'Unknown report' }, { status: 404 })
      ),
      () => 'UTC'
    );
    await assert.rejects(client.run('nope', { range: null, group: null }, 1), {
      message: 'Unknown report',
      status: 404
    });
  });
});
