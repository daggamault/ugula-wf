import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { claimSearchOf, createClaimsClient } from './client.ts';

describe('createClaimsClient', () => {
  it('reads claims and sends payer orders, payments and submissions', async () => {
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
    await client.list({ task: 'any', assignee: 'anyone' }, 'page=1');
    await client.list({ task: '', assignee: 'me' }, 'page=1');
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
    await client.createBatch('c1');
    await client.markSubmitted('c1');
    assert.equal(client.fileUrl('b1'), 'http://api.test/api/submissions/batches/b1/file');
    assert.equal(client.encounterUrl('r1'), 'http://api.test/api/imports/reports/r1/xml');
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?status=open&page=2&pageSize=25&sort=balance&dir=desc ',
      'GET http://api.test/api/claims?status=all&lastName=doe&birthDate=1980-01-02&patientId=p1&page=1 ',
      'GET http://api.test/api/claims?task=any&page=1 ',
      'GET http://api.test/api/claims?assignee=me&page=1 ',
      'GET http://api.test/api/claims/c1 ',
      'PUT http://api.test/api/claims/c1/payers {"payers":["Medicare"]}',
      'POST http://api.test/api/claims/c1/restart-cycle ',
      'POST http://api.test/api/claims/c1/responses {"requestId":"q1","coverageId":null,"paidCents":500,"adjustedCents":0,"note":""}',
      'GET http://api.test/api/submissions/pending ',
      'GET http://api.test/api/submissions/pending?claimId=c1 ',
      'POST http://api.test/api/submissions/batches {"claimId":"c1"}',
      'POST http://api.test/api/submissions/manual {"claimId":"c1"}'
    ]);
  });

  it('reads claim filters from the URL, defaulting to open claims', () => {
    assert.deepEqual(claimSearchOf(new URLSearchParams('')), {
      status: 'open',
      firstName: '',
      lastName: '',
      birthDate: '',
      number: '',
      task: '',
      assignee: 'anyone'
    });
    const search = claimSearchOf(new URLSearchParams('status=needs_review&number=42'));
    assert.deepEqual([search.status, search.number], ['needs_review', '42']);
    assert.equal(claimSearchOf(new URLSearchParams('status=bogus')).status, 'open');
    const work = claimSearchOf(new URLSearchParams('task=billing-review&assignee=me'));
    assert.deepEqual([work.task, work.assignee], ['billing-review', 'me']);
    assert.equal(claimSearchOf(new URLSearchParams('assignee=them')).assignee, 'anyone');
  });
});
