import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createFeeRoutes } from './routes.ts';
import type { FeeService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const service = {
  list: async (...args: unknown[]) => {
    calls.push(['list', ...args]);
    return ok({ fees: [] });
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
  it('lists, saves and deletes fees for the session tenant', async () => {
    assert.equal((await request('/')).status, 200);
    const saved = await request('/', {
      method: 'PUT',
      body: JSON.stringify({ code: 'a0427', amountCents: 50000 })
    });
    assert.equal(saved.status, 200);
    assert.equal((await request(`/${ID}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      ['list', 't-1'],
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
