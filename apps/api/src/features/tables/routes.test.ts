import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createTableRoutes } from './routes.ts';
import type { TableService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
const OTHER = '01a16617-7704-7ba6-b9b5-9c79fa44f960';

const calls: { name: string; args: unknown[] }[] = [];

const record =
  <T>(name: string, answer: (...args: unknown[]) => T) =>
  async (...args: unknown[]) => {
    calls.push({ name, args });
    return answer(...args);
  };

const service = {
  search: record('search', () => ok({ items: [] })),
  effective: record('effective', () => ok({ tables: [{ key: 'billing.base-rate' }] })),
  create: record('create', () => ok({ id: ID, key: 'agency.rates' })),
  find: record('find', (_a, id) =>
    id === ID ? ok({ table: { id } }) : fail('not_found', 'Table not found')
  ),
  compare: record('compare', () =>
    ok({ mine: null, copiedFrom: null, latest: null, baseChanged: false })
  ),
  version: record('version', () => ok({ version: 2 })),
  saveDraft: record('saveDraft', () => ok({ version: 2 })),
  publish: record('publish', () => fail('invalid', 'Fix it')),
  override: record('override', () => ok({ id: ID })),
  remove: record('remove', () => ok({ id: ID }))
} as unknown as TableService;

const access = testAccess();
const request = withSession(createTableRoutes(service), access);

const send = async (method: string, path: string, body?: unknown) => {
  calls.length = 0;
  const res = await request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: res.status, body: await res.json(), calls: [...calls] };
};

describe('table routes', () => {
  it('searches tables with the paging defaults', async () => {
    assert.deepEqual(await send('GET', '/?show=customized&q=rate'), {
      status: 200,
      body: { items: [] },
      calls: [
        {
          name: 'search',
          args: [
            access,
            { q: 'rate', show: 'customized', page: 1, pageSize: 25, sort: 'name', dir: 'asc' }
          ]
        }
      ]
    });
    const bad = await send('GET', '/?show=mine');
    assert.deepEqual([bad.status, bad.calls], [400, []]);
  });

  it('lists the effective tables', async () => {
    assert.deepEqual(await send('GET', '/effective'), {
      status: 200,
      body: { tables: [{ key: 'billing.base-rate' }] },
      calls: [{ name: 'effective', args: [access] }]
    });
  });

  it('creates a table and refuses an invalid one', async () => {
    const table = { name: 'Rates', kind: 'decide', definition: { rows: [] } };
    assert.deepEqual(await send('POST', '/', table), {
      status: 201,
      body: { id: ID, key: 'agency.rates' },
      calls: [{ name: 'create', args: [access, { ...table, description: '' }] }]
    });
    const issue = 'name: Use a name with at least one letter';
    assert.deepEqual(await send('POST', '/', { ...table, name: '123' }), {
      status: 400,
      body: { error: issue, issues: [issue] },
      calls: []
    });
  });

  it('finds a table, its comparison and a version', async () => {
    assert.deepEqual(await send('GET', `/${ID}`), {
      status: 200,
      body: { table: { id: ID } },
      calls: [{ name: 'find', args: [access, ID] }]
    });
    assert.deepEqual(await send('GET', `/${ID}/compare`), {
      status: 200,
      body: { mine: null, copiedFrom: null, latest: null, baseChanged: false },
      calls: [{ name: 'compare', args: [access, ID] }]
    });
    assert.deepEqual(await send('GET', `/${ID}/versions/2`), {
      status: 200,
      body: { version: 2 },
      calls: [{ name: 'version', args: [access, ID, 2] }]
    });
  });

  it('answers 404 for a missing table and 400 for malformed ids and versions', async () => {
    assert.deepEqual(await send('GET', `/${OTHER}`), {
      status: 404,
      body: { error: 'Table not found' },
      calls: [{ name: 'find', args: [access, OTHER] }]
    });
    for (const path of ['/nope', '/nope/compare', `/${ID}/versions/0`, `/${ID}/versions/x`]) {
      const res = await send('GET', path);
      assert.deepEqual([res.status, res.calls], [400, []], path);
    }
  });

  it('saves a draft and refuses one without a definition that fits', async () => {
    assert.deepEqual(await send('PUT', `/${ID}/draft`, { definition: { rows: [] } }), {
      status: 200,
      body: { version: 2 },
      calls: [{ name: 'saveDraft', args: [access, ID, { rows: [] }] }]
    });
    const big = await send('PUT', `/${ID}/draft`, { definition: 'x'.repeat(600_000) });
    assert.deepEqual([big.status, big.calls], [400, []]);
  });

  it('publishes, overrides and removes with the agency access', async () => {
    assert.deepEqual(await send('POST', `/${ID}/publish`), {
      status: 422,
      body: { error: 'Fix it' },
      calls: [{ name: 'publish', args: [access, ID] }]
    });
    assert.deepEqual(await send('POST', `/${ID}/override`), {
      status: 201,
      body: { id: ID },
      calls: [{ name: 'override', args: [access, ID] }]
    });
    assert.deepEqual(await send('DELETE', `/${ID}`), {
      status: 200,
      body: { id: ID },
      calls: [{ name: 'remove', args: [access, ID] }]
    });
    for (const [method, path] of [
      ['POST', '/nope/publish'],
      ['POST', '/nope/override'],
      ['DELETE', '/nope']
    ] as const) {
      const res = await send(method, path);
      assert.deepEqual([res.status, res.calls], [400, []], `${method} ${path}`);
    }
  });
});
