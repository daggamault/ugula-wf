import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createDepositRoutes } from './routes.ts';
import type { DepositService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];
const record =
  (name: string, value: unknown) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok(value);
  };

const service = {
  search: record('search', { items: [], total: 0, page: 1, pageSize: 25 }),
  find: record('find', { deposit: { id: ID } }),
  record: record('record', { id: ID })
} as unknown as DepositService;

const request = withSession(createDepositRoutes(service));

describe('deposit routes', () => {
  it('lists, reads and records deposits of the session agency as the session user', async () => {
    assert.equal((await request('/?q=eft&sort=amount')).status, 200);
    assert.deepEqual(await (await request(`/${ID}`)).json(), { deposit: { id: ID } });
    const created = await request('/', {
      method: 'POST',
      body: JSON.stringify({ traceNumber: 'EFT1', amountCents: 1000, depositedOn: '2026-11-02' })
    });
    assert.equal(created.status, 201);
    assert.deepEqual(calls, [
      ['search', 't-1', { q: 'eft', page: 1, pageSize: 25, sort: 'amount', dir: 'desc' }],
      ['find', 't-1', ID],
      [
        'record',
        't-1',
        'u-1',
        {
          traceNumber: 'EFT1',
          amountCents: 1000,
          depositedOn: '2026-11-02',
          payerName: null,
          note: null
        }
      ]
    ]);
  });

  it('refuses a bad id or body', async () => {
    assert.equal((await request('/nope')).status, 400);
    assert.equal(
      (await request('/', { method: 'POST', body: JSON.stringify({ traceNumber: '' }) })).status,
      400
    );
  });
});
