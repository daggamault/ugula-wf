import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import {
  type Clearinghouse,
  claimFileName,
  type RemoteFile,
  receiverOf
} from '../../shared/clearinghouse.ts';
import { createClearinghousePoll } from './poll.ts';

const isa = (receiver: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${receiver.padEnd(15)}*261103*1200*^*00501*000000001*0*T*:~GS*FA~`;

const file = (name: string): RemoteFile => ({
  path: `/outbound/999/${name}`,
  name,
  size: 10,
  modifiedAt: new Date('2026-11-03T12:00:00Z')
});

const fakeClearinghouse = (files: Record<string, string>) => {
  const removed: string[] = [];
  const clearinghouse: Clearinghouse = {
    config: {
      host: 'localhost',
      port: 2223,
      username: 'u',
      password: 'p',
      uploadPath: '/inbound',
      downloadPaths: ['/outbound/999'],
      fileExtension: '.txt',
      afterDownload: 'delete',
      pollMinutes: 1
    },
    upload: async (name) => name,
    list: async () => Object.keys(files).map(file),
    download: async (path) => new TextEncoder().encode(files[path.split('/').at(-1) ?? ''] ?? ''),
    remove: async (path) => void removed.push(path)
  };
  return { clearinghouse, removed };
};

describe('clearinghouse names', () => {
  it('names claim files without extra periods and reads the receiver of a response', () => {
    assert.equal(
      claimFileName(7, '0195f2a4-0000-7000-8000-000000000001', '.CLP'),
      '837P-000000007-0195f2a4.CLP'
    );
    assert.equal(receiverOf(isa('DEVEMS01')), 'DEVEMS01');
    assert.equal(receiverOf('not x12'), null);
  });
});

describe('createClearinghousePoll', () => {
  it('starts a Receive Payer File run per new file for the agency it is addressed to', async () => {
    const { db, queries } = createRecordingDb((q: CompiledQuery) => {
      if (q.sql.includes('from "clearinghouse_downloads"')) return [];
      if (q.sql.includes('from "billing_profiles"')) {
        return q.parameters.includes('DEVEMS01') ? [{ tenant_id: 't1' }] : [];
      }
      if (q.sql.includes('from "graph_versions"')) return [{ id: 'v1', version: 1 }];
      if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'r1' }];
      return [];
    });
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_n, batch) => void jobs.push(...batch) };
    const stored: string[] = [];
    const blobs = {
      putBytes: async (key: string, body: Uint8Array, contentType: string) => {
        stored.push(key);
        return { bucket: 'b', key, size: body.byteLength, contentType };
      }
    };
    const { clearinghouse, removed } = fakeClearinghouse({
      'a.999': isa('DEVEMS01'),
      'b.999': isa('SOMEONE')
    });
    const reports: string[] = [];
    await createClearinghousePoll({
      db,
      boss,
      blobs,
      clearinghouse,
      report: (m) => reports.push(m)
    })();
    assert.equal(stored.length, 1);
    assert.match(stored[0] ?? '', /^clearinghouse\/t1\/\d+-a\.999$/);
    assert.deepEqual(removed, ['/outbound/999/a.999']);
    const downloads = queries.filter((q) =>
      q.sql.startsWith('insert into "clearinghouse_downloads"')
    );
    assert.equal(downloads.length, 2);
    assert.ok(downloads[1]?.parameters.includes('No agency has submitter ID SOMEONE'));
    assert.match(reports[1] ?? '', /left \/outbound\/999\/b\.999 on the server/);
    await db.destroy();
  });

  it('skips files it already downloaded', async () => {
    const { db } = createRecordingDb((q: CompiledQuery) =>
      q.sql.includes('from "clearinghouse_downloads"') ? [{ id: 'd1' }] : []
    );
    const { clearinghouse, removed } = fakeClearinghouse({ 'a.999': isa('DEVEMS01') });
    const boss: RunQueueClient = { insert: async () => undefined };
    const blobs = { putBytes: async () => assert.fail('should not store') };
    await createClearinghousePoll({ db, boss, blobs, clearinghouse, report: () => undefined })();
    assert.deepEqual(removed, []);
    await db.destroy();
  });
});
