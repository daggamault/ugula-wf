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
  find: record('find', { claim: { id: ID }, codes: {} }),
  edit: record('edit', { id: ID, revision: 3 })
} as unknown as ClaimService;

const place = { name: null, line: null, city: null, state: null, postalCode: null };

const EDIT = {
  revision: 2,
  serviceDate: '2026-10-01',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 7.4,
  originCode: 'R',
  destinationCode: 'H',
  transportReason: 'A',
  conditionCodes: ['06'],
  weightPounds: null,
  diagnoses: ['R079'],
  patient: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    birthDate: '1950-12-10',
    sex: 'F',
    addressLine: '1 Elm St',
    city: 'Dayton',
    state: 'OH',
    postalCode: '45402'
  },
  pickup: place,
  destination: place,
  priorAuthorization: null,
  signatureOnFile: true,
  note: null,
  coverages: [
    {
      payerId: null,
      payerName: 'Medicare',
      memberId: '1EG4',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  lines: [{ code: 'A0427', modifiers: ['RH'], units: 1, unitCents: 85_000 }]
};

const request = withSession(createClaimRoutes(service));

describe('claim routes', () => {
  it('list and read claims', async () => {
    calls.length = 0;
    assert.equal((await request('/?status=needs_review&lastName=doe')).status, 200);
    assert.equal((await request('/?sort=total&dir=asc')).status, 200);
    assert.equal((await request('/?status=open')).status, 400);
    const found = await request(`/${ID}`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { claim: { id: ID }, codes: {} });
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
        {
          status: ['needs_review'],
          lastName: 'doe',
          page: 1,
          pageSize: 25,
          sort: 'created',
          dir: 'desc'
        }
      ],
      ['search', 't-1', { status: [], page: 1, pageSize: 25, sort: 'total', dir: 'asc' }],
      ['find', 't-1', ID]
    ]);
  });

  it('edit a claim as the signed-in biller, and refuse a malformed edit', async () => {
    calls.length = 0;
    const res = await request(`/${ID}`, { method: 'PUT', body: JSON.stringify(EDIT) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: ID, revision: 3 });
    assert.deepEqual(calls, [['edit', 't-1', 'u-1', ID, EDIT]]);
    const bad = await request(`/${ID}`, {
      method: 'PUT',
      body: JSON.stringify({ ...EDIT, level: 'ALS9', revision: 0 })
    });
    assert.equal(bad.status, 400);
  });

  it('have no other endpoints that change a claim', async () => {
    for (const [path, method] of [
      ['tasks', 'POST'],
      ['restart-cycle', 'POST'],
      ['events', 'POST']
    ] as const) {
      const res = await request(`/${ID}/${path}`, { method, body: '{}' });
      assert.equal(res.status, 404, path);
    }
  });

  it('maps a missing claim to 404', async () => {
    const send = withSession(
      createClaimRoutes({
        find: async () => fail('not_found', 'Claim not found')
      } as unknown as ClaimService)
    );
    assert.equal((await send(`/${ID}`)).status, 404);
  });
});
