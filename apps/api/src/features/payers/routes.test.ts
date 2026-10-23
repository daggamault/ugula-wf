import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createPayerRoutes } from './routes.ts';
import type { PayerService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
const calls: unknown[][] = [];
const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok({});
  };

const service = {
  list: record('list'),
  save: record('save'),
  remove: record('remove')
} as unknown as PayerService;

const request = withSession(createPayerRoutes(service));

describe('payer routes', () => {
  it('lists, saves and deletes payers for the session tenant', async () => {
    await request('/');
    const body = { name: 'Medicare', payerId: '00952', claimFiling: 'MB' };
    assert.equal((await request('/', { method: 'PUT', body: JSON.stringify(body) })).status, 200);
    await request(`/${ID}`, { method: 'DELETE' });
    assert.deepEqual(calls, [
      ['list', 't-1'],
      ['save', 't-1', body],
      ['remove', 't-1', ID]
    ]);
    const bad = await request('/', {
      method: 'PUT',
      body: JSON.stringify({ ...body, claimFiling: 'ZZ' })
    });
    assert.equal(bad.status, 400);
  });
});
