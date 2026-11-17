import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createFeesClient } from './client.ts';

const recordingApi = (reply: unknown) => {
  const calls: unknown[][] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return reply;
    };
  const api = { get: record('get'), put: record('put'), remove: record('remove') };
  return { client: createFeesClient(api as unknown as Api), calls };
};

describe('createFeesClient', () => {
  it('searches fees with the page query and passes the abort signal on', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recordingApi(page);
    const signal = new AbortController().signal;
    assert.equal(await client.search('q=a04&page=1', signal), page);
    assert.deepEqual(calls, [['get', '/api/fees?q=a04&page=1', signal]]);
  });

  it('reads one fee out of its envelope', async () => {
    const { client, calls } = recordingApi({ fee: { id: 'f 1', code: 'A0427' } });
    assert.deepEqual(await client.fee('f 1'), { id: 'f 1', code: 'A0427' });
    assert.deepEqual(calls, [['get', '/api/fees/f%201', undefined]]);
  });

  it('lists every directory payer when the name is blank', async () => {
    const payers = [{ id: 'p-m', name: 'Medicare' }];
    const { client, calls } = recordingApi({ payers });
    const signal = new AbortController().signal;
    assert.equal(await client.payers('   ', signal), payers);
    assert.deepEqual(calls, [['get', '/api/payers/names', signal]]);
  });

  it('filters directory payers by the trimmed name', async () => {
    const { client, calls } = recordingApi({ payers: [] });
    assert.deepEqual(await client.payers(' blue & cross '), []);
    assert.deepEqual(calls, [['get', '/api/payers/names?q=blue%20%26%20cross', undefined]]);
  });

  it('saves a fee and returns the stored row', async () => {
    const { client, calls } = recordingApi({ fee: { id: 'f1', code: 'A0427' } });
    const input = { payerId: null, code: 'A0427', amountCents: 95000 };
    assert.deepEqual(await client.save(input), { id: 'f1', code: 'A0427' });
    assert.deepEqual(calls, [['put', '/api/fees', input]]);
  });

  it('removes a fee by id', async () => {
    const { client, calls } = recordingApi({ id: 'f 1' });
    assert.deepEqual(await client.remove('f 1'), { id: 'f 1' });
    assert.deepEqual(calls, [['remove', '/api/fees/f%201']]);
  });
});
