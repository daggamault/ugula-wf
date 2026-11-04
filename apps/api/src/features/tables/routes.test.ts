import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgencyAccess } from '../../shared/access.ts';
import { fail, ok } from '../../shared/result.ts';
import { testAccess, withSession } from '../../shared/testing.ts';
import { createTableRoutes } from './routes.ts';
import type { TableService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const record =
  <T>(value: T) =>
  async (...args: unknown[]) => {
    calls.push(args);
    return value;
  };

const service = {
  search: async (access: AgencyAccess, filters: unknown) =>
    ok({ items: [], args: [access.agencyId, filters] }),
  find: async (_a: AgencyAccess, id: string) =>
    id === ID ? ok({ table: { id } }) : fail('not_found', 'Table not found'),
  compare: record(ok({ mine: null, copiedFrom: null, latest: null, baseChanged: false })),
  version: async (_a: AgencyAccess, id: string, version: number) => ok({ args: [id, version] }),
  saveDraft: record(ok({ version: 2 })),
  publish: async () => fail('invalid', 'Fix it'),
  override: record(ok({ id: ID })),
  remove: record(ok({ id: ID }))
} as unknown as TableService;

const access = testAccess();
const request = withSession(createTableRoutes(service), access);
const send = (method: string, path: string, body?: unknown) =>
  request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe('table routes', () => {
  it('serve lists, tables, versions and comparisons', async () => {
    assert.deepEqual(await (await request('/?show=customized')).json(), {
      items: [],
      args: ['t-1', { show: 'customized', page: 1, pageSize: 25, sort: 'name', dir: 'asc' }]
    });
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.equal((await request('/01a16617-7704-7ba6-b9b5-9c79fa44f960')).status, 404);
    assert.equal((await request('/nope')).status, 400);
    assert.deepEqual(await (await request(`/${ID}/versions/2`)).json(), { args: [ID, 2] });
    assert.equal((await request(`/${ID}/compare`)).status, 200);
  });

  it('save, publish, override and remove with the agency access', async () => {
    assert.equal((await send('PUT', `/${ID}/draft`, { definition: { rows: [] } })).status, 200);
    assert.deepEqual(calls.at(-1), [access, ID, { rows: [] }]);
    assert.equal((await send('POST', `/${ID}/publish`)).status, 422);
    assert.equal((await send('POST', `/${ID}/override`, {})).status, 201);
    assert.deepEqual(calls.at(-1), [access, ID, 'agency']);
    assert.equal((await send('DELETE', `/${ID}`)).status, 200);
  });
});
