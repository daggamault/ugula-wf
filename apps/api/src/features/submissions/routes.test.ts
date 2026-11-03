import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
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
  eligibility: record('eligibility', { name: 'eligibility-1-7.x12', file: 'ISA*', payers: [] }),
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
  it('builds an eligibility request for one claim', async () => {
    assert.equal((await post('/eligibility', { claimId: ID })).status, 201);
    assert.deepEqual(calls.splice(0), [['eligibility', 't-1', ID]]);
    assert.equal((await post('/eligibility', {})).status, 400);
  });

  it('no longer creates 837P files or manual submissions, which the claim cycle does', async () => {
    assert.equal((await post('/batches', { claimId: ID })).status, 404);
    assert.equal((await post('/manual', { claimId: ID })).status, 404);
    assert.equal(calls.length, 0);
  });

  it('downloads a batch file as an attachment', async () => {
    const res = await request(`/batches/${ID}/file`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/edi-x12');
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="837P-/);
    assert.equal(await res.text(), 'ISA*00');
  });
});

describe('submission route failures', () => {
  const failing = withSession(
    createSubmissionRoutes({
      eligibility: async (_tenantId: string, claimId: string) =>
        claimId === ID
          ? fail('conflict', 'Batch control numbers are used up; contact support')
          : fail('invalid', 'Add a billing profile in Settings', { issues: [] }),
      document: async () => fail('not_found', 'Batch not found')
    } as unknown as SubmissionService)
  );

  it('maps missing batches, invalid ids and refused requests to their statuses', async () => {
    const missing = await failing(`/batches/${ID}/file`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Batch not found' });
    assert.equal((await failing('/batches/nope/file')).status, 400);
    const used = await failing('/eligibility', {
      method: 'POST',
      body: JSON.stringify({ claimId: ID })
    });
    assert.equal(used.status, 409);
    const other = '01a16617-7704-7ba6-b9b5-9c79fa44f966';
    const invalid = await failing('/eligibility', {
      method: 'POST',
      body: JSON.stringify({ claimId: other })
    });
    assert.equal(invalid.status, 422);
    assert.deepEqual(await invalid.json(), {
      error: 'Add a billing profile in Settings',
      issues: []
    });
  });
});
