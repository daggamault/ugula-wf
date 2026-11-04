import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { deleteConnection, findConnection, updateConnection } from './queries.ts';

describe('clearinghouse connection queries', () => {
  it('scope every read and write to the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findConnection(db, 't1'), undefined);
    assert.equal(await deleteConnection(db, 't1'), false);
    assert.equal(
      await updateConnection(db, 't1', {
        vendor: 'custom-sftp',
        enabled: false,
        sftpHost: 'h',
        sftpPort: 22,
        sftpUsername: 'u',
        secret: null,
        uploadPath: '/',
        downloadPaths: ['/'],
        claimExtension: '.txt',
        eligibilityExtension: '.txt',
        claimStatusExtension: '.txt',
        afterDownload: 'keep',
        realtimeUrl: null
      }),
      undefined
    );
    for (const q of queries) {
      assert.ok(q.sql.includes('"agency_id" = $'), q.sql);
      assert.ok(q.parameters.includes('t1'));
    }
  });
});
