import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createSubmissionRoutes } from './routes.ts';
import type { SubmissionService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];
const record =
  (name: string, value: unknown) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok(value);
  };

const service = {
  pending: record('pending', { issues: [], claims: [] }),
  list: record('list', { batches: [] }),
  create: record('create', { batch: { id: ID } }),
  markSubmitted: record('markSubmitted', { payer: 'Medicare' }),
  document: async () =>
    ok({
      bytes: new TextEncoder().encode('ISA*00'),
      contentType: 'application/edi-x12',
      name: '837P-000000001.txt'
    })
} as unknown as SubmissionService;

const request = withSession(createSubmissionRoutes(service));

const post = (path: string, body: unknown) =>
  request(path, { method: 'POST', body: JSON.stringify(body) });

describe('submission routes', () => {
  it('lists pending claims and batches for the session tenant', async () => {
    assert.equal((await request('/pending')).status, 200);
    assert.equal((await request('/batches?limit=10')).status, 200);
    assert.deepEqual(calls.splice(0), [
      ['pending', 't-1'],
      ['list', 't-1', 10]
    ]);
  });

  it('creates batches as the session user and validates the selection', async () => {
    assert.equal((await post('/batches', { claimIds: [ID] })).status, 201);
    assert.deepEqual(calls.splice(0), [['create', 't-1', 'u-1', [ID]]]);
    assert.equal((await post('/batches', { claimIds: [] })).status, 400);
    assert.equal((await post('/batches', { claimIds: ['nope'] })).status, 400);
    assert.equal(calls.length, 0);
  });

  it('records manual submissions with an optional note', async () => {
    assert.equal((await post('/manual', { claimId: ID })).status, 201);
    assert.deepEqual(calls.splice(0), [['markSubmitted', 't-1', 'u-1', ID, '']]);
  });

  it('downloads a batch file as an attachment', async () => {
    const res = await request(`/batches/${ID}/file`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/edi-x12');
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="837P-/);
    assert.equal(await res.text(), 'ISA*00');
  });
});
