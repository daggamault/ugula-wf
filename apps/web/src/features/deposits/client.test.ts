import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createDepositsClient, type DepositInput } from './client.ts';

const recordingApi = (reply: unknown) => {
  const calls: unknown[][] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return reply;
    };
  const api = { get: record('get'), post: record('post') } as unknown as Api;
  return { client: createDepositsClient(api), calls };
};

describe('createDepositsClient', () => {
  it('searches deposits with the page query and passes the abort signal on', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recordingApi(page);
    const signal = new AbortController().signal;
    assert.equal(await client.search('q=123&page=1', signal), page);
    assert.deepEqual(calls, [['get', '/api/deposits?q=123&page=1', signal]]);
  });

  it('reads one deposit out of its envelope', async () => {
    const { client, calls } = recordingApi({ deposit: { id: 'd 1', trace_number: '123' } });
    assert.deepEqual(await client.deposit('d 1'), { id: 'd 1', trace_number: '123' });
    assert.deepEqual(calls, [['get', '/api/deposits/d%201', undefined]]);
  });

  it('records a deposit', async () => {
    const input: DepositInput = {
      traceNumber: '123',
      amountCents: 60_000,
      depositedOn: '2026-11-02',
      payerName: null,
      note: null
    };
    const { client, calls } = recordingApi({ id: 'd1' });
    assert.deepEqual(await client.record(input), { id: 'd1' });
    assert.deepEqual(calls, [['post', '/api/deposits', input]]);
  });
});
