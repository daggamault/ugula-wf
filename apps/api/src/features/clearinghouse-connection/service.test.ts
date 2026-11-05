import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { ConnectionInput } from './schemas.ts';
import { createConnectionService, NO_SECRET_KEY, SECRET_FOR_ENDPOINT } from './service.ts';

const input: ConnectionInput = {
  vendor: 'waystar',
  enabled: true,
  sftpHost: 'sshftp.waystar.com',
  sftpPort: 22,
  sftpHostKey: `SHA256:${'w'.repeat(43)}`,
  sftpUsername: 'acme',
  secret: 'hunter2',
  uploadPath: '/upload',
  downloadPaths: ['/download'],
  claimExtension: '.CLP',
  eligibilityExtension: '.ELG',
  claimStatusExtension: '.CLS',
  afterDownload: 'delete',
  realtimeUrl: null
};

const row = { vendor: 'waystar', sftp_host: 'sshftp.waystar.com', secret_set: true };

const seal = (secret: string, agencyId: string) => `sealed(${secret}@${agencyId})`;

const serviceOf = (rows: (q: { sql: string }) => unknown[], allowLocal = false) => {
  const { db, queries } = createRecordingDb(rows);
  return { service: createConnectionService({ db, seal, allowLocal }), queries };
};

const messageOf = (r: { ok: true } | { ok: false; failure: { message: string } }) =>
  r.ok ? '' : r.failure.message;

describe('clearinghouse connection service', () => {
  it('reads the connection without its secret and says whether secrets can be stored', async () => {
    const { service, queries } = serviceOf(() => [row]);
    assert.deepEqual(await service.find('t1'), {
      ok: true,
      value: { connection: row, canStoreSecrets: true }
    });
    assert.ok(!queries[0]?.sql.includes('"sftp_secret",'));
    assert.ok(queries[0]?.sql.includes(`sftp_secret <> '' as "secret_set"`));
    const none = createConnectionService({
      db: createRecordingDb(() => []).db,
      seal: null,
      allowLocal: false
    });
    assert.deepEqual(await none.find('t1'), {
      ok: true,
      value: { connection: null, canStoreSecrets: false }
    });
  });

  it('seals a new secret for the agency, and keeps the stored one when none is given', async () => {
    const { service, queries } = serviceOf(() => [row]);
    assert.ok((await service.save('t1', input)).ok);
    assert.ok(queries[0]?.sql.includes('on conflict ("agency_id") do update set'));
    assert.ok(queries[0]?.parameters.includes('sealed(hunter2@t1)'));
    assert.ok(!queries[0]?.parameters.includes('hunter2'));
    assert.ok((await service.save('t1', { ...input, secret: null })).ok);
    assert.ok(queries[1]?.sql.startsWith('update "clearinghouse_connections"'));
    assert.ok(!queries[1]?.sql.includes('"sftp_secret" ='));
  });

  it('keeps the stored password only while the connection points at the same server', async () => {
    const { service, queries } = serviceOf((q) => (q.sql.startsWith('update') ? [] : [row]));
    const moved = await service.save('t1', {
      ...input,
      sftpHost: 'evil.example.com',
      secret: null
    });
    assert.equal(messageOf(moved), SECRET_FOR_ENDPOINT);
    assert.ok(queries[0]?.sql.includes('"sftp_host" = $'));
    assert.ok(queries[0]?.parameters.includes('evil.example.com'));
  });

  it('needs a password for a new connection and a key to store one', async () => {
    const missing = await serviceOf(() => []).service.save('t1', { ...input, secret: null });
    assert.match(messageOf(missing), /password for the new connection/);
    const keyless = createConnectionService({
      db: createRecordingDb(() => []).db,
      seal: null,
      allowLocal: false
    });
    const refused = await keyless.save('t1', input);
    assert.equal(messageOf(refused), NO_SECRET_KEY);
    assert.doesNotMatch(NO_SECRET_KEY, /CLEARINGHOUSE_/);
  });

  it('refuses private servers and the mock outside development', async () => {
    const strict = serviceOf(() => [row]);
    const refused = await strict.service.save('t1', { ...input, sftpHost: '127.0.0.1' });
    assert.equal(messageOf(refused), 'The SFTP host must be a public server');
    assert.equal(strict.queries.length, 0);
    const local = serviceOf(() => [row], true);
    assert.ok(
      (await local.service.save('t1', { ...input, vendor: 'mock', sftpHost: 'localhost' })).ok
    );
  });

  it('removes the connection so the server default applies again', async () => {
    const { service, queries } = serviceOf(() => [{}]);
    assert.deepEqual(await service.remove('t1'), { ok: true, value: { removed: true } });
    assert.ok(queries[0]?.sql.startsWith('delete from "clearinghouse_connections"'));
    const none = await serviceOf(() => []).service.remove('t1');
    assert.equal(none.ok ? null : none.failure.code, 'not_found');
  });
});
