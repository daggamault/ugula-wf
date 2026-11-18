import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createRemittanceRoutes } from './routes.ts';
import type { RemittanceService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('remittance routes', () => {
  it('list and read remittances', async () => {
    const calls: unknown[][] = [];
    const request = withSession(
      createRemittanceRoutes({
        search: async (...args: unknown[]) => {
          calls.push(['search', ...args]);
          return ok({ items: [] });
        },
        find: async (...args: unknown[]) => {
          calls.push(['find', ...args]);
          return ok({ remittance: { id: ID }, payments: [] });
        }
      } as unknown as RemittanceService)
    );
    assert.equal((await request('/?state=open&q=medicare')).status, 200);
    assert.equal((await request('/?state=lost')).status, 400);
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.equal((await request('/nope')).status, 400);
    assert.deepEqual(calls, [
      [
        'search',
        't-1',
        { q: 'medicare', state: ['open'], page: 1, pageSize: 25, sort: 'received', dir: 'desc' }
      ],
      ['find', 't-1', ID]
    ]);
  });

  it('maps a missing remittance to 404', async () => {
    const request = withSession(
      createRemittanceRoutes({
        find: async () => fail('not_found', 'Remittance not found')
      } as unknown as RemittanceService)
    );
    assert.equal((await request(`/${ID}`)).status, 404);
  });
});
