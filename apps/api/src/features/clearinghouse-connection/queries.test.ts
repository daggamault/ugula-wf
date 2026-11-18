import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteConnection,
  findConnection,
  updateKeepingSecret,
  upsertConnection
} from './queries.ts';
import type { ConnectionInput } from './schemas.ts';

const RETURNING =
  '"vendor", "is_active", "sftp_host", "sftp_port", "sftp_host_key", "sftp_username", ' +
  '"upload_path", "download_paths", "claim_extension", "eligibility_extension", ' +
  '"claim_status_extension", "after_download", "realtime_url", "updated_at", ' +
  'sftp_secret <> \'\' as "secret_set"';

const INPUT: ConnectionInput = {
  vendor: 'custom-sftp',
  isActive: false,
  sftpHost: 'h',
  sftpPort: 22,
  sftpHostKey: 'SHA256:k',
  sftpUsername: 'u',
  secret: null,
  uploadPath: '/up',
  downloadPaths: ['/down'],
  claimExtension: '.clp',
  eligibilityExtension: '.elg',
  claimStatusExtension: '.cls',
  afterDownload: 'keep',
  realtimeUrl: null
};

const VALUES = [
  'custom-sftp',
  false,
  'h',
  22,
  'SHA256:k',
  'u',
  '/up',
  ['/down'],
  '.clp',
  '.elg',
  '.cls',
  'keep',
  null
];

const ROW = { vendor: 'custom-sftp', secret_set: true };

describe('findConnection', () => {
  it('reads the agency connection and whether a secret is stored, never the secret', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await findConnection(db, 't1'), ROW);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [[`select ${RETURNING} from "clearinghouse_connections" where "agency_id" = $1`, ['t1']]]
    );
  });

  it('finds nothing for an agency without a connection', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findConnection(db, 't1'), undefined);
  });
});

describe('upsertConnection', () => {
  it('inserts the connection with the sealed secret or replaces it on conflict', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await upsertConnection(db, 't1', INPUT, 'sealed'), ROW);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "clearinghouse_connections" ("agency_id", "vendor", "is_active", ' +
            '"sftp_host", "sftp_port", "sftp_host_key", "sftp_username", "upload_path", ' +
            '"download_paths", "claim_extension", "eligibility_extension", ' +
            '"claim_status_extension", "after_download", "realtime_url", "sftp_secret") values ' +
            '($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ' +
            'on conflict ("agency_id") do update set "vendor" = $16, "is_active" = $17, ' +
            '"sftp_host" = $18, "sftp_port" = $19, "sftp_host_key" = $20, "sftp_username" = $21, ' +
            '"upload_path" = $22, "download_paths" = $23, "claim_extension" = $24, ' +
            '"eligibility_extension" = $25, "claim_status_extension" = $26, ' +
            '"after_download" = $27, "realtime_url" = $28, "sftp_secret" = $29, ' +
            `"updated_at" = now() returning ${RETURNING}`,
          ['t1', ...VALUES, 'sealed', ...VALUES, 'sealed']
        ]
      ]
    );
  });

  it('throws when the upsert returns no row', async () => {
    const { db } = createRecordingDb(() => []);
    await assert.rejects(upsertConnection(db, 't1', INPUT, 'sealed'), { message: 'no result' });
  });
});

describe('updateKeepingSecret', () => {
  it('updates the connection only while the host, port, key, user and realtime URL are unchanged', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await updateKeepingSecret(db, 't1', INPUT), ROW);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'update "clearinghouse_connections" set "vendor" = $1, "is_active" = $2, ' +
            '"sftp_host" = $3, "sftp_port" = $4, "sftp_host_key" = $5, "sftp_username" = $6, ' +
            '"upload_path" = $7, "download_paths" = $8, "claim_extension" = $9, ' +
            '"eligibility_extension" = $10, "claim_status_extension" = $11, ' +
            '"after_download" = $12, "realtime_url" = $13, "updated_at" = now() ' +
            'where "agency_id" = $14 and "sftp_host" = $15 and "sftp_port" = $16 and ' +
            '"sftp_host_key" = $17 and "sftp_username" = $18 and ' +
            `"realtime_url" is not distinct from $19 returning ${RETURNING}`,
          [...VALUES, 't1', 'h', 22, 'SHA256:k', 'u', null]
        ]
      ]
    );
  });

  it('updates nothing when the destination changed or there is no connection', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await updateKeepingSecret(db, 't1', INPUT), undefined);
  });
});

describe('deleteConnection', () => {
  it('deletes the agency connection', async () => {
    const { db, queries } = createRecordingDb(() => [{}]);
    assert.equal(await deleteConnection(db, 't1'), true);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [['delete from "clearinghouse_connections" where "agency_id" = $1', ['t1']]]
    );
  });

  it('reports a missing connection', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await deleteConnection(db, 't1'), false);
  });
});
