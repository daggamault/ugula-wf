import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createConnectionRoutes } from './routes.ts';
import type { ConnectionService } from './service.ts';

const calls: unknown[][] = [];

const record =
  (name: string) =>
  async (...args: unknown[]) => {
    calls.push([name, ...args]);
    return ok({});
  };

const request = withSession(
  createConnectionRoutes({
    find: record('find'),
    save: record('save'),
    remove: record('remove')
  } as unknown as ConnectionService)
);

const body = {
  vendor: 'mock',
  enabled: true,
  sftpHost: 'localhost',
  sftpPort: 2223,
  sftpHostKey: MOCK_HOST_KEY,
  sftpUsername: 'ugula',
  secret: null,
  uploadPath: '/upload',
  downloadPaths: ['/download'],
  claimExtension: '.CLP',
  eligibilityExtension: '.ELG',
  claimStatusExtension: '.CLS',
  afterDownload: 'delete',
  realtimeUrl: 'http://localhost:2224/core/realtime'
};

describe('clearinghouse connection routes', () => {
  it('reads, saves and removes the session agency connection, rejecting invalid ones', async () => {
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/', { method: 'PUT', body: JSON.stringify(body) })).status, 200);
    const bad = await request('/', {
      method: 'PUT',
      body: JSON.stringify({ ...body, claimExtension: 'CLP' })
    });
    assert.equal(bad.status, 400);
    assert.equal((await request('/', { method: 'DELETE' })).status, 200);
    assert.deepEqual(calls, [
      ['find', 't-1'],
      ['save', 't-1', body],
      ['remove', 't-1']
    ]);
  });
});
