import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createFeeRoutes } from './routes.ts';
import type { FeeService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const service = {
  search: async (...args: unknown[]) => {
    calls.push(['search', ...args]);
    return ok({ items: [] });
  },
  find: async (...args: unknown[]) => {
    calls.push(['find', ...args]);
    return ok({ fee: { id: ID } });
  },
  save: async (...args: unknown[]) => {
    calls.push(['save', ...args]);
    return ok({ fee: { id: ID } });
  },
  remove: async (...args: unknown[]) => {
    calls.push(['remove', ...args]);
    return ok({ status: 'deleted' });
  }
} as unknown as FeeService;

const request = withSession(createFeeRoutes(service));

describe('fee routes', () => {
  it('searches, finds, saves and deletes fees for the session agency', async () => {
    assert.equal((await request('/?q=a04&sort=amount')).status, 200);
    assert.equal((await request(`/${ID}`)).status, 200);
    const saved = await request('/', {
      method: 'PUT',
      body: JSON.stringify({ code: 'a0427', amountCents: 50000 })
    });
    assert.equal(saved.status, 200);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      ['search', 't-1', { q: 'a04', page: 1, pageSize: 25, sort: 'amount', dir: 'asc' }],
      ['find', 't-1', ID],
      ['save', 't-1', { payerId: null, code: 'A0427', amountCents: 50000 }],
      ['remove', 't-1', ID]
    ]);
  });

  it('rejects invalid fees and ids', async () => {
    const bad = await request('/', {
      method: 'PUT',
      body: JSON.stringify({ code: 'nope', amountCents: 1 })
    });
    assert.equal(bad.status, 400);
    assert.equal((await request('/not-a-uuid', { method: 'DELETE' })).status, 400);
  });
});

describe('fee route failures', () => {
  it('maps missing fees to 404 and payers outside the directory to 422', async () => {
    const failing = {
      search: async () => ok({ items: [] }),
      find: async () => fail('not_found', 'Fee not found'),
      save: async () => fail('invalid', 'Choose a payer from the payer directory'),
      remove: async () => fail('not_found', 'Fee not found')
    } as unknown as FeeService;
    const send = withSession(createFeeRoutes(failing));
    assert.equal((await send(`/${ID}`)).status, 404);
    assert.equal((await send(`/${ID}`, { method: 'DELETE' })).status, 404);
    const saved = await send('/', {
      method: 'PUT',
      body: JSON.stringify({ payerId: ID, code: 'A0427', amountCents: 1 })
    });
    assert.equal(saved.status, 422);
    assert.deepEqual(await saved.json(), { error: 'Choose a payer from the payer directory' });
    assert.equal((await send('/?sort=price')).status, 400);
    assert.equal((await send(`/?q=${'x'.repeat(81)}`)).status, 400);
  });
});
