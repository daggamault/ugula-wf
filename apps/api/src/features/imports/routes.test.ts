import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createImportRoutes, createSftpRoutes } from './routes.ts';
import type { ImportService } from './service.ts';

const calls: unknown[][] = [];

const service = {
  list: async (tenantId: string, page: unknown) => {
    calls.push(['list', tenantId, page]);
    return ok({ imports: [] });
  },
  upload: async (
    tenantId: string,
    userId: string,
    workflow: string,
    file: { name: string; bytes: Uint8Array }
  ) => {
    calls.push([tenantId, userId, workflow, file.name, new TextDecoder().decode(file.bytes)]);
    return workflow === 'billing.missing'
      ? fail('not_found', 'nope')
      : ok({ runId: 'r1', file: { bucket: 'b', key: 'k', size: 4, contentType: 'x' } });
  },
  authenticateSftp: async (username: string, password: string) =>
    password === 'good'
      ? ok({ status: 1, username })
      : fail('unauthorized', 'Invalid SFTP credentials'),
  receiveSftpEvent: async (event: { action: string }) => ok({ received: event.action }),
  find: async (tenantId: string, id: string) => {
    calls.push(['find', tenantId, id]);
    return ok({ import: { id }, reports: [] });
  },
  report: async (tenantId: string, id: string) => {
    calls.push(['report', tenantId, id]);
    return ok({ report: { id }, data: {}, xml: '' });
  }
} as unknown as ImportService;

const request = withSession(createImportRoutes(service, 16));

const form = (fields: Record<string, string | File>) => {
  const body = new FormData();
  for (const [k, value] of Object.entries(fields)) body.append(k, value);
  return { method: 'POST', body };
};

describe('import routes', () => {
  it('lists recent imports for the session tenant', async () => {
    assert.equal((await request('/?page=2&pageSize=10&sort=claims&dir=asc')).status, 200);
    assert.deepEqual(calls.at(-1), [
      'list',
      't-1',
      { page: 2, pageSize: 10, sort: 'claims', dir: 'asc' }
    ]);
    assert.equal((await request('/?pageSize=7')).status, 400);
  });

  it('serves one stored report by id', async () => {
    const id = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
    assert.equal((await request(`/reports/${id}`)).status, 200);
    assert.deepEqual(calls.at(-1), ['report', 't-1', id]);
    assert.equal((await request('/reports/nope')).status, 400);
    assert.equal((await request(`/${id}`)).status, 200);
    assert.deepEqual(calls.at(-1), ['find', 't-1', id]);
  });

  it('accepts a multipart file for the session tenant', async () => {
    const res = await request('/', form({ file: new File(['<x/>'], 'pcrs.xml') }));
    assert.equal(res.status, 201);
    assert.deepEqual(calls.at(-1), ['t-1', 'u-1', 'billing.ingest-nemsis', 'pcrs.xml', '<x/>']);
    const missing = form({ file: new File(['<x/>'], 'a.xml'), workflow: 'billing.missing' });
    assert.equal((await request('/', missing)).status, 404);
  });

  it('rejects missing files and oversized bodies', async () => {
    assert.equal((await request('/', form({ workflow: 'billing.ingest-nemsis' }))).status, 400);
    const big = await request('/', form({ file: new File(['x'.repeat(200_000)], 'big.xml') }));
    assert.equal(big.status, 413);
  });
});

describe('SFTP hook routes', () => {
  const secret = 'x'.repeat(32);
  const hooks = createSftpRoutes(service, secret);
  const post = (path: string, body: unknown, token = secret) =>
    hooks.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });

  it('requires the shared hook secret', async () => {
    assert.equal(
      (await post('/auth', { username: 'a', password: 'good' }, 'y'.repeat(32))).status,
      401
    );
    assert.equal((await post('/auth', { username: 'a', password: 'good' }, 'short')).status, 401);
  });

  it('answers SFTPGo auth with a user or a denial and accepts upload events', async () => {
    const allowed = await post('/auth', { username: 'acme-ems', password: 'good', ip: '1.2.3.4' });
    assert.deepEqual(await allowed.json(), { status: 1, username: 'acme-ems' });
    assert.equal((await post('/auth', { username: 'acme-ems', password: 'bad' })).status, 401);
    const event = await post('/upload', {
      action: 'upload',
      username: 'acme-ems',
      virtual_path: '/a.xml',
      file_size: 3,
      status: 1,
      protocol: 'SFTP'
    });
    assert.deepEqual(await event.json(), { received: 'upload' });
    assert.equal((await post('/upload', { action: 'upload' })).status, 400);
  });
});
