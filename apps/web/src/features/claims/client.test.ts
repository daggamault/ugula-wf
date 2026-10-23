import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createClaimsClient } from './client.ts';

describe('createClaimsClient', () => {
  it('reads claims and sends payer orders and responses', async () => {
    const seen: string[] = [];
    const client = createClaimsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        return new Response('{"claims":[]}', { status: 200 });
      })
    );
    assert.deepEqual(await client.list('open'), []);
    await client.find('c1');
    await client.setPayers('c1', ['Medicare']);
    await client.restartCycle('c1');
    await client.recordResponse('c1', {
      requestId: 'q1',
      payer: null,
      paidCents: 500,
      adjustedCents: 0,
      note: ''
    });
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?status=open ',
      'GET http://api.test/api/claims/c1 ',
      'PUT http://api.test/api/claims/c1/payers {"payers":["Medicare"]}',
      'POST http://api.test/api/claims/c1/restart-cycle ',
      'POST http://api.test/api/claims/c1/responses {"requestId":"q1","payer":null,"paidCents":500,"adjustedCents":0,"note":""}'
    ]);
  });
});
