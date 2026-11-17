import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createReportsClient, reportSearch } from './client.ts';

const range = { from: '2026-01-01', to: '2026-06-30' };

describe('reportSearch', () => {
  it('sends the date range and time zone for the first page', () => {
    assert.equal(
      reportSearch({ range, group: null }, 1, 'UTC'),
      'from=2026-01-01&to=2026-06-30&tz=UTC'
    );
  });

  it('sends the group and later pages without a date range', () => {
    assert.equal(
      reportSearch({ range: null, group: 'class' }, 3, 'America/Chicago'),
      'group=class&tz=America%2FChicago&page=3'
    );
  });

  it('asks for every row instead of a page', () => {
    assert.equal(reportSearch({ range: null, group: null }, 'all', 'UTC'), 'tz=UTC&all=true');
  });

  it('sends every option together', () => {
    assert.equal(
      reportSearch({ range, group: 'payer' }, 2, 'UTC'),
      'from=2026-01-01&to=2026-06-30&group=payer&tz=UTC&page=2'
    );
  });
});

const recording = (reply: unknown, status = 200) => {
  const seen: string[] = [];
  const zones: string[] = [];
  const client = createReportsClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)}`);
        return Response.json(reply, { status });
      },
      () => undefined,
      () => null
    ),
    () => {
      zones.push('America/Denver');
      return 'America/Denver';
    }
  );
  return { client, seen, zones };
};

describe('createReportsClient', () => {
  it('runs a report by id in the browser time zone and returns the result', async () => {
    const result = { items: [{ month: '2026-01' }], total: 1 };
    const { client, seen } = recording(result);
    assert.deepEqual(await client.run('monthly', { range, group: null }, 2), result);
    await client.run('write-offs', { range, group: null }, 'all');
    assert.deepEqual(seen, [
      'GET http://api.test/api/reports/monthly?from=2026-01-01&to=2026-06-30&tz=America%2FDenver&page=2',
      'GET http://api.test/api/reports/write-offs?from=2026-01-01&to=2026-06-30&tz=America%2FDenver&all=true'
    ]);
  });

  it('reads the time zone on every run', async () => {
    const { client, zones } = recording({});
    await client.run('aging', { range: null, group: null }, 1);
    await client.run('aging', { range: null, group: null }, 1);
    assert.equal(zones.length, 2);
  });

  it('encodes the report id', async () => {
    const { client, seen } = recording({});
    await client.run('a/b?c', { range: null, group: null }, 1);
    assert.deepEqual(seen, ['GET http://api.test/api/reports/a%2Fb%3Fc?tz=America%2FDenver']);
  });

  it('rejects with the server error and its status', async () => {
    const { client } = recording({ error: 'Unknown report' }, 404);
    await assert.rejects(client.run('nope', { range: null, group: null }, 1), {
      message: 'Unknown report',
      status: 404
    });
  });
});
