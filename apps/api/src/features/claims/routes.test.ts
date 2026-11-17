import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createClaimRoutes } from './routes.ts';
import type { ClaimService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];
const record =
  (name: string, value: unknown) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok(value);
  };

const service = {
  search: record('search', { claims: [] }),
  find: record('find', { claim: { id: ID }, files: [] }),
  events: record('events', { items: [], total: 0, page: 1, pageSize: 25 }),
  restartCycle: record('restartCycle', { runId: 'r2' }),
  startTask: record('startTask', { runId: 'r5' }),
  documentFile: async () =>
    ok({
      bytes: new TextEncoder().encode('%PDF-1.7'),
      name: 'p c s.pdf'
    }),
  document: async () =>
    ok({
      bytes: new TextEncoder().encode('%PDF-1.7'),
      name: '2-abc.pdf'
    })
} as unknown as ClaimService;

const request = withSession(createClaimRoutes(service));

describe('claim routes', () => {
  it('list and read claims', async () => {
    calls.length = 0;
    assert.equal((await request('/?status=all&lastName=doe')).status, 200);
    assert.equal((await request('/?sort=waiting&dir=asc')).status, 200);
    assert.equal((await request('/?status=paid')).status, 400);
    const found = await request(`/${ID}`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { claim: { id: ID }, files: [] });
    const invalid = await request('/nope');
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      error: 'id: Invalid UUID: Received "nope"',
      issues: ['id: Invalid UUID: Received "nope"']
    });
    assert.deepEqual(calls, [
      [
        'search',
        't-1',
        { status: 'all', lastName: 'doe', page: 1, pageSize: 25, sort: 'created', dir: 'desc' }
      ],
      ['search', 't-1', { status: 'open', page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' }],
      ['find', 't-1', ID]
    ]);
  });

  it('start a claim task workflow as the session user and return its run', async () => {
    calls.length = 0;
    const started = await request(`/${ID}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ workflow: 'billing.change-responsible-party' })
    });
    assert.equal(started.status, 201);
    assert.deepEqual(await started.json(), { runId: 'r5' });
    assert.deepEqual(calls, [['startTask', 't-1', 'u-1', ID, 'billing.change-responsible-party']]);
    const other = await request(`/${ID}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ workflow: 'billing.cycle-claim' })
    });
    assert.equal(other.status, 400);
  });

  it('have no endpoints that change a claim directly', async () => {
    for (const [path, method] of [
      ['payers', 'PUT'],
      ['billing-data', 'PUT'],
      ['facility', 'PUT'],
      ['responses', 'POST'],
      ['documents', 'POST'],
      ['document-chases', 'POST'],
      ['records-request', 'POST']
    ] as const) {
      assert.equal((await request(`/${ID}/${path}`, { method, body: '{}' })).status, 404, path);
    }
  });

  it('serve claim documents and stored files inline', async () => {
    const file = await request(`/${ID}/documents/${ID}`);
    assert.equal(file.headers.get('content-disposition'), 'inline; filename="p_c_s.pdf"');
    assert.equal(await file.text(), '%PDF-1.7');
    const res = await request(`/${ID}/events/${ID}/document`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-disposition'), 'inline; filename="2-abc.pdf"');
    assert.equal(await res.text(), '%PDF-1.7');
    assert.equal((await request(`/${ID}/events/nope/document`)).status, 400);
    assert.equal((await request(`/${ID}/documents/nope`)).status, 400);
  });

  it('pages and sorts claim history on the server', async () => {
    calls.length = 0;
    assert.equal((await request(`/${ID}/events`)).status, 200);
    assert.equal(
      (await request(`/${ID}/events?sort=amount&dir=asc&page=2&pageSize=10`)).status,
      200
    );
    assert.equal((await request(`/${ID}/events?sort=nope`)).status, 400);
    assert.deepEqual(calls.splice(0), [
      ['events', 't-1', ID, { page: 1, pageSize: 25, sort: 'when', dir: 'desc' }],
      ['events', 't-1', ID, { page: 2, pageSize: 10, sort: 'amount', dir: 'asc' }]
    ]);
  });

  it('restarts a claim cycle', async () => {
    const res = await request(`/${ID}/restart-cycle`, { method: 'POST' });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { runId: 'r2' });
    assert.deepEqual(calls.at(-1), ['restartCycle', 't-1', ID]);
  });
});

describe('claim files that are not a viewable document', () => {
  it('download as untyped attachments the browser may not sniff, under a safe name', async () => {
    const html = {
      bytes: new TextEncoder().encode('<script>alert(1)</script>'),
      name: 'x".html'
    };
    const send = withSession(
      createClaimRoutes({
        document: async () => ok(html),
        documentFile: async () => ok(html)
      } as unknown as ClaimService)
    );
    for (const path of [`/${ID}/events/${ID}/document`, `/${ID}/documents/${ID}`]) {
      const res = await send(path);
      assert.equal(res.headers.get('content-type'), 'application/octet-stream');
      assert.equal(res.headers.get('content-disposition'), 'attachment; filename="x_.html"');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    }
  });
});

describe('claim route failures', () => {
  const failing = {
    find: async () => fail('not_found', 'Claim not found'),
    events: async () => fail('not_found', 'Claim not found'),
    document: async () => fail('not_found', 'Document not found'),
    documentFile: async () => fail('not_found', 'Document not found'),
    restartCycle: async () => fail('conflict', 'This claim still has an active workflow run'),
    startTask: async () => fail('conflict', 'Claim is already closed')
  } as unknown as ClaimService;
  const send = withSession(createClaimRoutes(failing));

  it('maps missing claims to 404 and conflicts to 409', async () => {
    const statuses = await Promise.all(
      [
        send(`/${ID}`),
        send(`/${ID}/events`),
        send(`/${ID}/events/${ID}/document`),
        send(`/${ID}/documents/${ID}`),
        send(`/${ID}/restart-cycle`, { method: 'POST' }),
        send(`/${ID}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ workflow: 'billing.post-payment' })
        })
      ].map(async (res) => (await res).status)
    );
    assert.deepEqual(statuses, [404, 404, 404, 404, 409, 409]);
    const missing = await send(`/${ID}/events/${ID}/document`);
    assert.deepEqual(await missing.json(), { error: 'Document not found' });
  });
});
