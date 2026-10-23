import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
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
  find: record('find', { claim: { id: ID }, events: [] }),
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
    assert.equal((await request('/?status=paid')).status, 200);
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
      ['list', 't-1', { status: 'paid', page: 1, pageSize: 25, sort: 'created', dir: 'desc' }],
      ['find', 't-1', ID],
      ['setPayers', 't-1', ID, ['Medicare']],
      [
        'recordResponse',
        't-1',
        'u-1',
        ID,
        { requestId: ID, coverageId: ID, paidCents: 100, adjustedCents: 0, note: '' }
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
    assert.deepEqual(calls.at(-1)?.[3], {
      ...body,
      patient: { addressLine: null, city: null, state: 'IL', postalCode: null },
      pickup: { name: null, addressLine: null, city: null, state: null, postalCode: null },
      destination: { name: null, addressLine: null, city: null, state: null, postalCode: null },
      diagnoses: ['R079'],
      originDestination: 'RH'
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
