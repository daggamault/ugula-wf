import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createPayersClient, type PayerInput } from './client.ts';

const recordingClient = (body: unknown, status = 200) => {
  const calls: string[] = [];
  const client = createPayersClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`.trimEnd());
        return Response.json(body, { status });
      },
      () => undefined,
      () => null
    )
  );
  return { client, calls };
};

const input: PayerInput = {
  name: 'Medicare',
  payerCode: '00952',
  claimFiling: 'MB',
  filingLimitDays: 365,
  correctionMethod: null,
  appealDays: null,
  planType: null
};

describe('createPayersClient', () => {
  it('searches payers with the table query', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recordingClient(page);
    assert.deepEqual(await client.search('q=blue&page=1'), page);
    assert.deepEqual(calls, ['GET http://api.test/api/payers?q=blue&page=1']);
  });

  it('reads one payer by encoded id', async () => {
    const { client, calls } = recordingClient({ payer: { id: 'a b' } });
    assert.deepEqual(await client.payer('a b'), { id: 'a b' });
    assert.deepEqual(calls, ['GET http://api.test/api/payers/a%20b']);
  });

  it('saves a payer and says how many claims it linked', async () => {
    const saved = { payer: { id: 'p1' }, linkedClaims: 2 };
    const { client, calls } = recordingClient(saved);
    assert.deepEqual(await client.save(input), saved);
    assert.deepEqual(calls, [`PUT http://api.test/api/payers ${JSON.stringify(input)}`]);
  });

  it('removes a payer and forgets one of its names by encoded ids', async () => {
    const { client, calls } = recordingClient({ id: 'a/b' });
    assert.deepEqual(await client.remove('a/b'), { id: 'a/b' });
    await client.forgetAlias('a/b', 'x y');
    assert.deepEqual(calls, [
      'DELETE http://api.test/api/payers/a%2Fb',
      'DELETE http://api.test/api/payers/a%2Fb/aliases/x%20y'
    ]);
  });

  it('rejects with the reason the server gives', async () => {
    const { client } = recordingClient({ error: 'Payer is billed on open claims' }, 409);
    await assert.rejects(client.remove('p1'), {
      message: 'Payer is billed on open claims',
      status: 409
    });
  });
});
