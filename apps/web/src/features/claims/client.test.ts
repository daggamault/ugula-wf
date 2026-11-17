import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { claimSearchOf, createClaimsClient } from './client.ts';

const recording = (reply: (url: string) => unknown = () => ({})) => {
  const seen: string[] = [];
  const client = createClaimsClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        return new Response(JSON.stringify(reply(String(url))), { status: 200 });
      },
      undefined,
      () => null
    )
  );
  return { client, seen };
};

describe('createClaimsClient', () => {
  it('lists claims with the trimmed, non-empty search before the page query', async () => {
    const page = { items: [], total: 0, page: 2, pageSize: 25 };
    const { client, seen } = recording(() => page);
    assert.deepEqual(
      await client.list({}, 'page=2&pageSize=25&sort=balance&dir=desc&status=denied'),
      page
    );
    await client.list(
      {
        firstName: '   ',
        lastName: ' doe ',
        number: '',
        birthDate: '1980-01-02',
        patientId: 'p1'
      },
      'page=1'
    );
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?page=2&pageSize=25&sort=balance&dir=desc&status=denied ',
      'GET http://api.test/api/claims?lastName=doe&birthDate=1980-01-02&patientId=p1&page=1 '
    ]);
  });

  it('finds a claim and pages its history', async () => {
    const { client, seen } = recording((url) => ({ url }));
    assert.deepEqual(await client.find('c/1'), { url: 'http://api.test/api/claims/c%2F1' });
    assert.deepEqual(await client.events('c1', 'page=2&sort=amount'), {
      url: 'http://api.test/api/claims/c1/events?page=2&sort=amount'
    });
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims/c%2F1 ',
      'GET http://api.test/api/claims/c1/events?page=2&sort=amount '
    ]);
  });

  it('restarts the cycle, starts tasks and checks eligibility for a claim', async () => {
    const { client, seen } = recording(() => ({ runId: 'r1' }));
    assert.deepEqual(await client.restartCycle('c 1'), { runId: 'r1' });
    assert.deepEqual(await client.startTask('c1', 'billing.post-payment'), { runId: 'r1' });
    await client.eligibilityRequest('c1');
    assert.deepEqual(await client.checkEligibility('c1'), { runId: 'r1' });
    assert.deepEqual(seen, [
      'POST http://api.test/api/claims/c%201/restart-cycle ',
      'POST http://api.test/api/claims/c1/tasks {"workflow":"billing.post-payment"}',
      'POST http://api.test/api/submissions/eligibility {"claimId":"c1"}',
      'POST http://api.test/api/submissions/eligibility-checks {"claimId":"c1"}'
    ]);
  });

  it('links to claim files without fetching them', () => {
    const { client, seen } = recording();
    assert.equal(
      client.documentUrl('c 1', 'e/1'),
      'http://api.test/api/claims/c%201/events/e%2F1/document'
    );
    assert.equal(
      client.claimDocumentUrl('c 1', 'd/1'),
      'http://api.test/api/claims/c%201/documents/d%2F1'
    );
    assert.equal(client.fileUrl('b 1'), 'http://api.test/api/submissions/batches/b%201/file');
    assert.equal(client.encounterUrl('r/1'), 'http://api.test/api/imports/reports/r%2F1/xml');
    assert.deepEqual(seen, []);
  });

  it('finds the first task of a started run, or none', async () => {
    let tasks = [{ id: 't1' }, { id: 't2' }];
    const { client, seen } = recording(() => ({ items: tasks, total: tasks.length }));
    assert.equal(await client.runTask('r 1'), 't1');
    tasks = [];
    assert.equal(await client.runTask('r2'), null);
    assert.deepEqual(seen, [
      'GET http://api.test/api/tasks?runId=r%201 ',
      'GET http://api.test/api/tasks?runId=r2 '
    ]);
  });

  it('rejects with the message the server sends back', async () => {
    const client = createClaimsClient(
      createApi(
        '',
        async () => new Response('{"error":"Claim is closed"}', { status: 409 }),
        undefined,
        () => null
      )
    );
    await assert.rejects(client.restartCycle('c1'), {
      message: 'Claim is closed',
      status: 409,
      body: { error: 'Claim is closed' }
    });
  });
});

describe('claimSearchOf', () => {
  it('reads an empty search when the URL names none', () => {
    assert.deepEqual(claimSearchOf(new URLSearchParams('')), {
      firstName: '',
      lastName: '',
      birthDate: '',
      number: ''
    });
  });

  it('reads only the search fields from the URL, as typed', () => {
    assert.deepEqual(
      claimSearchOf(
        new URLSearchParams(
          'tab=search&firstName=Jo&lastName=doe&birthDate=1980-01-02&number=+42&status=paid'
        )
      ),
      { firstName: 'Jo', lastName: 'doe', birthDate: '1980-01-02', number: ' 42' }
    );
  });
});
