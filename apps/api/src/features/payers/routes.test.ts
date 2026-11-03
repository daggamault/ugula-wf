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
  search: record('search'),
  names: record('names'),
  find: record('find'),
  save: record('save'),
  remove: record('remove'),
  forget: record('forget')
} as unknown as PayerService;

const request = withSession(createPayerRoutes(service));

describe('payer routes', () => {
  it('searches, finds, saves and deletes payers for the session tenant', async () => {
    await request('/?q=blue&page=2&sort=payerId&dir=desc');
    await request('/names');
    await request('/names?q=med');
    await request(`/${ID}`);
    const body = { name: 'Medicare', payerId: '00952', claimFiling: 'MB' };
    assert.equal((await request('/', { method: 'PUT', body: JSON.stringify(body) })).status, 200);
    await request(`/${ID}`, { method: 'DELETE' });
    await request(`/${ID}/aliases/${ID}`, { method: 'DELETE' });
    assert.equal((await request(`/${ID}/aliases/nope`, { method: 'DELETE' })).status, 400);
    assert.deepEqual(calls, [
      ['search', 't-1', { q: 'blue', page: 2, pageSize: 25, sort: 'payerId', dir: 'desc' }],
      ['names', 't-1', undefined],
      ['names', 't-1', 'med'],
      ['find', 't-1', ID],
      ['save', 't-1', { ...body, filingLimitDays: null }],
      ['remove', 't-1', ID],
      ['forget', 't-1', ID, ID]
    ]);
    const bad = await request('/', {
      method: 'PUT',
      body: JSON.stringify({ ...body, claimFiling: 'ZZ' })
    });
    assert.equal(bad.status, 400);
    assert.equal((await request('/?sort=nope')).status, 400);
  });
});
