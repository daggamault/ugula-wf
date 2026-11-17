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
  find: record('find', { claim: { id: ID }, codes: {} })
} as unknown as ClaimService;

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

  it('have no endpoints that change a claim', async () => {
    for (const [path, method] of [
      ['', 'PUT'],
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
