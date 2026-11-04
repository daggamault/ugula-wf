import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { ConnectionInput } from './schemas.ts';
import { createConnectionService, NO_SECRET_KEY } from './service.ts';

const input: ConnectionInput = {
  vendor: 'waystar',
  enabled: true,
  sftpHost: 'sshftp.waystar.com',
  sftpPort: 22,
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

describe('clearinghouse connection service', () => {
  it('reads the connection without its secret and says whether secrets can be stored', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    const service = createConnectionService({ db, seal });
    assert.deepEqual(await service.find('t1'), {
      ok: true,
      value: { connection: row, canStoreSecrets: true }
    });
    assert.ok(!queries[0]?.sql.includes('"sftp_secret",'));
    assert.ok(queries[0]?.sql.includes(`sftp_secret <> '' as "secret_set"`));
    const none = createConnectionService({ db: createRecordingDb(() => []).db, seal: null });
    assert.deepEqual(await none.find('t1'), {
      ok: true,
      value: { connection: null, canStoreSecrets: false }
    });
  });

  it('seals a new secret for the agency, and keeps the stored one when none is given', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    const service = createConnectionService({ db, seal });
    assert.ok((await service.save('t1', input)).ok);
    assert.ok(queries[0]?.sql.includes('on conflict ("agency_id") do update set'));
    assert.ok(queries[0]?.parameters.includes('sealed(hunter2@t1)'));
    assert.ok(!queries[0]?.parameters.includes('hunter2'));
    assert.ok((await service.save('t1', { ...input, secret: null })).ok);
    assert.ok(queries[1]?.sql.startsWith('update "clearinghouse_connections"'));
    assert.ok(!queries[1]?.sql.includes('"sftp_secret" ='));
  });

  it('needs a password for a new connection and a key to store one', async () => {
    const empty = createConnectionService({ db: createRecordingDb(() => []).db, seal });
    const missing = await empty.save('t1', { ...input, secret: null });
    assert.match(missing.ok ? '' : missing.failure.message, /password/);
    const keyless = createConnectionService({ db: createRecordingDb(() => []).db, seal: null });
    const refused = await keyless.save('t1', input);
    assert.equal(refused.ok ? '' : refused.failure.message, NO_SECRET_KEY);
  });

  it('removes the connection so the server default applies again', async () => {
    const { db, queries } = createRecordingDb(() => [{}]);
    assert.deepEqual(await createConnectionService({ db, seal }).remove('t1'), {
      ok: true,
      value: { removed: true }
    });
    assert.ok(queries[0]?.sql.startsWith('delete from "clearinghouse_connections"'));
    const none = await createConnectionService({ db: createRecordingDb(() => []).db, seal }).remove(
      't1'
    );
    assert.equal(none.ok ? null : none.failure.code, 'not_found');
  });
});
