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
    assert.deepEqual(
      await client.list({ status: 'open', q: '' }, 'page=2&pageSize=25&sort=balance&dir=desc'),
      { claims: [] }
    );
    await client.list({ status: 'all', q: ' doe ', patientId: 'p1' }, 'page=1');
    await client.find('c1');
    await client.setPayers('c1', ['Medicare']);
    await client.restartCycle('c1');
    await client.recordResponse('c1', {
      requestId: 'q1',
      coverageId: null,
      paidCents: 500,
      adjustedCents: 0,
      note: ''
    });
    await client.pending();
    await client.pending('c1');
    await client.batches('page=2&sort=total');
    await client.createBatch(['c1']);
    await client.markSubmitted('c1');
    assert.equal(client.fileUrl('b1'), 'http://api.test/api/submissions/batches/b1/file');
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?status=open&page=2&pageSize=25&sort=balance&dir=desc ',
      'GET http://api.test/api/claims?status=all&q=doe&patientId=p1&page=1 ',
      'GET http://api.test/api/claims/c1 ',
      'PUT http://api.test/api/claims/c1/payers {"payers":["Medicare"]}',
      'POST http://api.test/api/claims/c1/restart-cycle ',
      'POST http://api.test/api/claims/c1/responses {"requestId":"q1","coverageId":null,"paidCents":500,"adjustedCents":0,"note":""}',
      'GET http://api.test/api/submissions/pending ',
      'GET http://api.test/api/submissions/pending?claimId=c1 ',
      'GET http://api.test/api/submissions/batches?page=2&sort=total ',
      'POST http://api.test/api/submissions/batches {"claimIds":["c1"]}',
      'POST http://api.test/api/submissions/manual {"claimId":"c1"}'
    ]);
  });
});
