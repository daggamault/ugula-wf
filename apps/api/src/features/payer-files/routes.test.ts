import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORM_OVERHEAD_BYTES } from '../../shared/files.ts';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createPayerFileRoutes } from './routes.ts';
import type { PayerFileService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const service = {
  list: async (...args: unknown[]) => {
    calls.push(['list', ...args]);
    return ok({ items: [], total: 0, page: 1, pageSize: 25 });
  },
  find: async (...args: unknown[]) => {
    calls.push(['find', ...args]);
    return ok({ file: { id: ID }, items: [] });
  },
  download: async (...args: unknown[]) => {
    calls.push(['download', ...args]);
    return ok({ name: 'era 1.835', bytes: new TextEncoder().encode('ISA*') });
  },
  upload: async (tenantId: string, userId: string, file: { name: string; bytes: Uint8Array }) => {
    calls.push(['upload', tenantId, userId, file.name, file.bytes.byteLength]);
    return ok({ id: ID, kind: '835', items: 1, problems: 0 });
  }
} as unknown as PayerFileService;

const request = withSession(createPayerFileRoutes(service, 64));

describe('payer file routes', () => {
  it('lists, finds and downloads payer files for the session tenant', async () => {
    assert.equal((await request('/?sort=problems&dir=asc')).status, 200);
    assert.deepEqual(calls.at(-1), [
      'list',
      't-1',
      { page: 1, pageSize: 25, sort: 'problems', dir: 'asc' }
    ]);
    assert.equal((await request('/?sort=nope')).status, 400);
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.deepEqual(calls.at(-1), ['find', 't-1', ID]);
    const file = await request(`/${ID}/file`);
    assert.equal(file.headers.get('content-disposition'), 'attachment; filename="era_1.835"');
    assert.equal(await file.text(), 'ISA*');
    assert.equal((await request('/nope')).status, 400);
  });

  it('uploads one file, refusing bodies over the limit', async () => {
    const body = new FormData();
    body.append('file', new File(['ISA*00'], 'era.835'));
    assert.equal((await request('/', { method: 'POST', body })).status, 201);
    assert.deepEqual(calls.at(-1), ['upload', 't-1', 'u-1', 'era.835', 6]);
    const missing = new FormData();
    assert.equal((await request('/', { method: 'POST', body: missing })).status, 400);
    const large = new FormData();
    large.append('file', new File(['x'.repeat(FORM_OVERHEAD_BYTES + 65)], 'big.835'));
    const refused = await request('/', { method: 'POST', body: large });
    assert.equal(refused.status, 413);
    assert.deepEqual(await refused.json(), { error: 'File too large' });
    assert.deepEqual(calls.at(-1), ['upload', 't-1', 'u-1', 'era.835', 6]);
  });

  it('maps missing files and refused uploads to their statuses', async () => {
    const failing = withSession(
      createPayerFileRoutes(
        {
          find: async () => fail('not_found', 'Payer file not found'),
          download: async () => fail('not_found', 'Payer file not found'),
          upload: async () => fail('conflict', 'This file was already imported on 2026-10-01')
        } as unknown as PayerFileService,
        64
      )
    );
    assert.equal((await failing(`/${ID}`)).status, 404);
    const download = await failing(`/${ID}/file`);
    assert.equal(download.status, 404);
    assert.equal(download.headers.get('content-disposition'), null);
    const body = new FormData();
    body.append('file', new File(['ISA*00'], 'era.835'));
    assert.equal((await failing('/', { method: 'POST', body })).status, 409);
  });
});
