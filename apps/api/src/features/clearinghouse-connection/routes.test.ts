import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { fail, ok, type Result } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createConnectionRoutes } from './routes.ts';
import type { ConnectionService } from './service.ts';

const body = {
  vendor: 'mock',
  isActive: true,
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

type Name = 'find' | 'save' | 'remove';

const setup = (results: Partial<Record<Name, Result<unknown>>> = {}) => {
  const calls: unknown[][] = [];
  const record =
    (name: Name) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return results[name] ?? ok({ [name]: true });
    };
  const request = withSession(
    createConnectionRoutes({
      find: record('find'),
      save: record('save'),
      remove: record('remove')
    } as unknown as ConnectionService)
  );
  return { calls, request };
};

const put = (json: unknown) => ({ method: 'PUT', body: JSON.stringify(json) });

describe('clearinghouse connection routes', () => {
  it('reads the session agency connection', async () => {
    const { calls, request } = setup();
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { find: true });
    assert.deepEqual(calls, [['find', 't-1']]);
  });

  it('saves the session agency connection', async () => {
    const { calls, request } = setup();
    const res = await request('/', put(body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { save: true });
    assert.deepEqual(calls, [['save', 't-1', body]]);
  });

  it('rejects an invalid connection with its issues before saving', async () => {
    const { calls, request } = setup();
    const res = await request('/', put({ ...body, claimExtension: 'CLP' }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'claimExtension: Use an extension such as .CLP',
      issues: ['claimExtension: Use an extension such as .CLP']
    });
    assert.deepEqual(calls, []);
  });

  it('maps a refused save to 422', async () => {
    const { request } = setup({ save: fail('invalid', 'Enter the SFTP password') });
    const res = await request('/', put(body));
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'Enter the SFTP password' });
  });

  it('removes the session agency connection', async () => {
    const { calls, request } = setup();
    const res = await request('/', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { remove: true });
    assert.deepEqual(calls, [['remove', 't-1']]);
  });

  it('maps removing a missing connection to 404', async () => {
    const { request } = setup({
      remove: fail('not_found', 'This agency has no clearinghouse connection')
    });
    const res = await request('/', { method: 'DELETE' });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'This agency has no clearinghouse connection' });
  });
});
