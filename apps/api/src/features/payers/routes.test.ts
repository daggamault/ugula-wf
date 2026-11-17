import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
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
  it('searches, finds, saves and deletes payers for the session agency', async () => {
    await request('/?q=blue&page=2&sort=payerCode&dir=desc');
    await request('/names');
    await request('/names?q=med');
    await request(`/${ID}`);
    const body = { name: 'Medicare', payerCode: '00952', claimFiling: 'MB' };
    assert.equal((await request('/', { method: 'PUT', body: JSON.stringify(body) })).status, 200);
    await request(`/${ID}`, { method: 'DELETE' });
    await request(`/${ID}/aliases/${ID}`, { method: 'DELETE' });
    assert.equal((await request(`/${ID}/aliases/nope`, { method: 'DELETE' })).status, 400);
    assert.deepEqual(calls, [
      ['search', 't-1', { q: 'blue', page: 2, pageSize: 25, sort: 'payerCode', dir: 'desc' }],
      ['names', 't-1', undefined],
      ['names', 't-1', 'med'],
      ['find', 't-1', ID],
      [
        'save',
        't-1',
        {
          ...body,
          filingLimitDays: null,
          correctionMethod: null,
          appealDays: null,
          planType: null
        },
        { create: true, update: true }
      ],
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

describe('payer route failures', () => {
  it('maps payers and learned names the agency does not have to 404', async () => {
    const missing = withSession(
      createPayerRoutes({
        find: async () => fail('not_found', 'Payer not found'),
        remove: async () => fail('not_found', 'Payer not found'),
        forget: async () => fail('not_found', 'Payer name not found')
      } as unknown as PayerService)
    );
    const found = await missing(`/${ID}`);
    assert.equal(found.status, 404);
    assert.deepEqual(await found.json(), { error: 'Payer not found' });
    assert.equal((await missing(`/${ID}`, { method: 'DELETE' })).status, 404);
    assert.equal((await missing(`/${ID}/aliases/${ID}`, { method: 'DELETE' })).status, 404);
    assert.equal((await missing('/nope', { method: 'DELETE' })).status, 400);
  });
});

describe('payer route writes', () => {
  it('passes the writes the role holds and maps a refused save to 403', async () => {
    const seen: unknown[] = [];
    const refusing = {
      save: async (_agencyId: string, _input: unknown, writes: unknown) => {
        seen.push(writes);
        return fail('forbidden', "You can't change payers");
      }
    } as unknown as PayerService;
    const send = withSession(
      createPayerRoutes(refusing),
      testAccess(['payers:read', 'payers:create'])
    );
    const res = await send('/', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Medicare', payerCode: '00952', claimFiling: 'MB' })
    });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "You can't change payers" });
    assert.deepEqual(seen, [{ create: true, update: false }]);
  });
});
