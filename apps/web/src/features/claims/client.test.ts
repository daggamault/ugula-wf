import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { claimSearchOf, createClaimsClient } from './client.ts';

describe('createClaimsClient', () => {
  it('reads claims and starts claim tasks, cycles and eligibility checks', async () => {
    const seen: string[] = [];
    const client = createClaimsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        return new Response('{"claims":[]}', { status: 200 });
      })
    );
    assert.deepEqual(
      await client.list({ status: 'open' }, 'page=2&pageSize=25&sort=balance&dir=desc'),
      { claims: [] }
    );
    await client.list(
      { status: 'all', lastName: ' doe ', number: '', birthDate: '1980-01-02', patientId: 'p1' },
      'page=1'
    );
    await client.find('c1');
    await client.events('c1', 'page=2&sort=amount');
    await client.restartCycle('c1');
    await client.startTask('c1', 'billing.post-payment');
    await client.eligibilityRequest('c1');
    await client.checkEligibility('c1');
    assert.equal(client.fileUrl('b1'), 'http://api.test/api/submissions/batches/b1/file');
    assert.equal(
      client.documentUrl('c 1', 'e/1'),
      'http://api.test/api/claims/c%201/events/e%2F1/document'
    );
    assert.equal(client.encounterUrl('r1'), 'http://api.test/api/imports/reports/r1/xml');
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?status=open&page=2&pageSize=25&sort=balance&dir=desc ',
      'GET http://api.test/api/claims?status=all&lastName=doe&birthDate=1980-01-02&patientId=p1&page=1 ',
      'GET http://api.test/api/claims/c1 ',
      'GET http://api.test/api/claims/c1/events?page=2&sort=amount ',
      'POST http://api.test/api/claims/c1/restart-cycle ',
      'POST http://api.test/api/claims/c1/tasks {"workflow":"billing.post-payment"}',
      'POST http://api.test/api/submissions/eligibility {"claimId":"c1"}',
      'POST http://api.test/api/submissions/eligibility-checks {"claimId":"c1"}'
    ]);
  });

  it('finds the open task of a started run', async () => {
    const seen: string[] = [];
    const client = createClaimsClient(
      createApi('http://api.test', async (url) => {
        seen.push(String(url));
        return new Response(
          seen.length === 1 ? '{"items":[{"id":"t1"}],"total":1}' : '{"items":[],"total":0}',
          { status: 200 }
        );
      })
    );
    assert.equal(await client.runTask('r 1'), 't1');
    assert.equal(await client.runTask('r2'), null);
    assert.equal(seen[0], 'http://api.test/api/tasks?runId=r%201');
  });
  it('rejects with the message the server sends back', async () => {
    const client = createClaimsClient(
      createApi('', async () => new Response('{"error":"Claim is closed"}', { status: 409 }))
    );
    await assert.rejects(client.restartCycle('c1'), { message: 'Claim is closed', status: 409 });
  });

  it('reads the claim search from the URL', () => {
    assert.deepEqual(claimSearchOf(new URLSearchParams('')), {
      firstName: '',
      lastName: '',
      birthDate: '',
      number: ''
    });
    assert.deepEqual(
      claimSearchOf(new URLSearchParams('tab=search&lastName=doe&number=42&status=paid')),
      { firstName: '', lastName: 'doe', birthDate: '', number: '42' }
    );
  });
});
