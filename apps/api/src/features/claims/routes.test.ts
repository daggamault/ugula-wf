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
  list: record('list', { claims: [] }),
  find: record('find', { claim: { id: ID }, files: [] }),
  events: record('events', { items: [], total: 0, page: 1, pageSize: 25 }),
  setPayers: record('setPayers', { payers: [] }),
  recordResponse: record('recordResponse', { balanceCents: 0 }),
  restartCycle: record('restartCycle', { runId: 'r2' }),
  saveBillingData: record('saveBillingData', { status: 'saved' }),
  document: async () =>
    ok({
      bytes: new TextEncoder().encode('%PDF-1.7'),
      contentType: 'application/pdf',
      name: '2-abc.pdf'
    })
} as unknown as ClaimService;

const request = withSession(createClaimRoutes(service));

describe('claim routes', () => {
  it('list, read, reorder payers and record responses as the session user', async () => {
    assert.equal((await request('/?status=all&lastName=doe')).status, 200);
    assert.equal((await request('/?sort=waiting&dir=asc')).status, 200);
    assert.equal((await request('/?status=paid')).status, 400);
    assert.equal((await request(`/${ID}`)).status, 200);
    const payers = await request(`/${ID}/payers`, {
      method: 'PUT',
      body: JSON.stringify({ payers: ['Medicare'] })
    });
    assert.equal(payers.status, 200);
    const paid = await request(`/${ID}/responses`, {
      method: 'POST',
      body: JSON.stringify({ requestId: ID, coverageId: ID, paidCents: 100 })
    });
    assert.equal(paid.status, 201);
    assert.deepEqual(calls, [
      [
        'list',
        't-1',
        { status: 'all', lastName: 'doe', page: 1, pageSize: 25, sort: 'created', dir: 'desc' }
      ],
      ['list', 't-1', { status: 'open', page: 1, pageSize: 25, sort: 'waiting', dir: 'asc' }],
      ['find', 't-1', ID],
      [
        'setPayers',
        't-1',
        ID,
        [{ name: 'Medicare', relationship: '18', insuredFirstName: null, insuredLastName: null }]
      ],
      [
        'recordResponse',
        't-1',
        'u-1',
        ID,
        {
          requestId: ID,
          kind: 'response',
          coverageId: ID,
          paidCents: 100,
          adjustedCents: 0,
          paidOn: null,
          checkNumber: null,
          payerClaimNumber: null,
          adjustments: [],
          note: ''
        }
      ]
    ]);
  });

  it('saves billing data and rejects malformed values', async () => {
    const body = {
      patient: { state: 'IL' },
      coverages: [],
      serviceDate: '2026-10-01',
      pickup: {},
      destination: {},
      diagnoses: ['R07.9'],
      originDestination: 'rh'
    };
    const res = await request(`/${ID}/billing-data`, { method: 'PUT', body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['saveBillingData', 't-1', 'u-1']);
    assert.deepEqual(calls.at(-1)?.[4], {
      ...body,
      patient: { addressLine: null, city: null, state: 'IL', postalCode: null },
      pickup: { name: null, addressLine: null, city: null, state: null, postalCode: null },
      destination: { name: null, addressLine: null, city: null, state: null, postalCode: null },
      diagnoses: ['R079'],
      originDestination: 'RH',
      documentation: null,
      note: null
    });
    const bad = await request(`/${ID}/billing-data`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, diagnoses: ['nope'] })
    });
    assert.equal(bad.status, 400);
    const badModifier = await request(`/${ID}/billing-data`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, originDestination: 'RZ' })
    });
    assert.equal(badModifier.status, 400);
  });

  it('pages and sorts claim history on the server', async () => {
    calls.length = 0;
    assert.equal((await request(`/${ID}/events`)).status, 200);
    assert.equal(
      (await request(`/${ID}/events?sort=amount&dir=asc&page=2&pageSize=10`)).status,
      200
    );
    assert.equal((await request(`/${ID}/events?sort=nope`)).status, 400);
    assert.equal((await request('/nope/events')).status, 400);
    assert.deepEqual(calls.splice(0), [
      ['events', 't-1', ID, { page: 1, pageSize: 25, sort: 'when', dir: 'desc' }],
      ['events', 't-1', ID, { page: 2, pageSize: 10, sort: 'amount', dir: 'asc' }]
    ]);
  });

  it('streams claim documents inline', async () => {
    const res = await request(`/${ID}/events/${ID}/document`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-disposition'), 'inline; filename="2-abc.pdf"');
    assert.equal(await res.text(), '%PDF-1.7');
    assert.equal((await request(`/${ID}/events/nope/document`)).status, 400);
  });

  it('restarts a claim cycle', async () => {
    const res = await request(`/${ID}/restart-cycle`, { method: 'POST' });
    assert.equal(res.status, 201);
    assert.deepEqual(calls.at(-1), ['restartCycle', 't-1', ID]);
  });

  it('rejects invalid ids, payers and amounts', async () => {
    assert.equal((await request('/nope')).status, 400);
    const dup = await request(`/${ID}/payers`, {
      method: 'PUT',
      body: JSON.stringify({ payers: ['A', 'A'] })
    });
    assert.equal(dup.status, 400);
    const negative = await request(`/${ID}/responses`, {
      method: 'POST',
      body: JSON.stringify({ requestId: ID, paidCents: -5 })
    });
    assert.equal(negative.status, 400);
  });
});

describe('claim route failures', () => {
  const failing = {
    find: async () => fail('not_found', 'Claim not found'),
    events: async () => fail('not_found', 'Claim not found'),
    setPayers: async () => fail('conflict', 'Medicare already has billing activity'),
    document: async () => fail('not_found', 'Document not found'),
    saveBillingData: async () => fail('invalid', 'A coverage is not on this claim'),
    restartCycle: async () => fail('conflict', 'This claim still has an active workflow run'),
    recordResponse: async () => fail('invalid', 'That payer is not on this claim')
  } as unknown as ClaimService;
  const send = withSession(createClaimRoutes(failing));

  it('maps missing claims to 404, conflicts to 409 and rule failures to 422', async () => {
    const statuses = await Promise.all(
      [
        send(`/${ID}`),
        send(`/${ID}/events`),
        send(`/${ID}/payers`, { method: 'PUT', body: JSON.stringify({ payers: [] }) }),
        send(`/${ID}/events/${ID}/document`),
        send(`/${ID}/billing-data`, { method: 'PUT', body: '{}' }),
        send(`/${ID}/restart-cycle`, { method: 'POST' }),
        send(`/${ID}/responses`, { method: 'POST', body: JSON.stringify({ requestId: ID }) })
      ].map(async (res) => (await res).status)
    );
    assert.deepEqual(statuses, [404, 404, 409, 404, 422, 409, 422]);
    const missing = await send(`/${ID}/events/${ID}/document`);
    assert.deepEqual(await missing.json(), { error: 'Document not found' });
  });
});
