import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunJob, RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import type { Clearinghouse, ClearinghouseConfig, RemoteFile } from '../../shared/clearinghouse.ts';
import { createClearinghousePoll } from './poll.ts';

const isa = (receiver: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${receiver.padEnd(15)}*261103*1200*^*00501*000000001*0*T*:~GS*FA~`;

const file = (name: string): RemoteFile => ({
  path: `/outbound/999/${name}`,
  name,
  size: 10,
  modifiedAt: new Date('2026-11-03T12:00:00Z')
});

const fakeClearinghouse = (
  files: Record<string, string>,
  afterDownload: ClearinghouseConfig['afterDownload'] = 'delete'
) => {
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
      afterDownload,
      pollMinutes: 1
    },
    upload: async (name) => name,
    list: async () => Object.keys(files).map(file),
    download: async (path) => new TextEncoder().encode(files[path.split('/').at(-1) ?? ''] ?? ''),
    remove: async (path) => void removed.push(path)
  };
  return { clearinghouse, removed };
};

type Directory = { profiles?: Record<string, string[]>; published?: boolean };

const poll = async (
  clearinghouse: Clearinghouse,
  { profiles = { DEVEMS01: ['t1'] }, published = true }: Directory = {}
) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "billing_profiles"')) {
      return (profiles[String(q.parameters[0])] ?? []).map((tenant_id) => ({ tenant_id }));
    }
    if (q.sql.includes('from "graph_versions"')) return published ? [{ id: 'v1', version: 1 }] : [];
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'r1' }];
    return [];
  });
  const jobs: RunJob[] = [];
  const boss: RunQueueClient = {
    insert: async (_, batch) => void jobs.push(...batch.map((j) => j.data as RunJob))
  };
  const stored: string[] = [];
  const blobs = {
    putBytes: async (key: string, body: Uint8Array, contentType: string) => {
      stored.push(key);
      return { bucket: 'b', key, size: body.byteLength, contentType };
    }
  };
  const reports: string[] = [];
  await createClearinghousePoll({
    db,
    boss,
    blobs,
    clearinghouse,
    report: (m) => reports.push(m)
  })();
  await db.destroy();
  const downloads = queries.filter((q) =>
    q.sql.startsWith('insert into "clearinghouse_downloads"')
  );
  const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
  return { downloads, run, jobs, stored, reports };
};

describe('createClearinghousePoll', () => {
  it('starts a Receive Payer File run per new file for the agency it is addressed to', async () => {
    const { clearinghouse, removed } = fakeClearinghouse({ 'a.999': isa('DEVEMS01') });
    const { downloads, run, jobs, stored, reports } = await poll(clearinghouse);
    assert.deepEqual(stored, [`clearinghouse/t1/${Date.parse('2026-11-03T12:00:00Z')}-a.999`]);
    assert.ok(run?.parameters.includes('t1') && run.parameters.includes('v1'));
    assert.ok(
      run?.parameters.some((p) => typeof p === 'string' && p.includes('"fileName":"a.999"'))
    );
    assert.deepEqual(jobs, [{ runId: 'r1', command: { type: 'advance' } }]);
    assert.deepEqual(downloads[0]?.parameters, [
      '/outbound/999/a.999',
      10,
      new Date('2026-11-03T12:00:00Z'),
      't1',
      'r1',
      ''
    ]);
    assert.deepEqual(removed, ['/outbound/999/a.999']);
    assert.deepEqual(reports, ['Clearinghouse: received /outbound/999/a.999, run r1']);
  });

  it('keeps received files on the server when configured to', async () => {
    const { clearinghouse, removed } = fakeClearinghouse({ 'a.999': isa('DEVEMS01') }, 'keep');
    const { jobs } = await poll(clearinghouse);
    assert.equal(jobs.length, 1);
    assert.deepEqual(removed, []);
  });

  it('records and leaves on the server files no single agency can take, saying why', async () => {
    const { clearinghouse, removed } = fakeClearinghouse({
      'a.999': 'not x12',
      'b.999': isa('SOMEONE'),
      'c.999': isa('SHARED'),
      'd.999': isa('DEVEMS01')
    });
    const { downloads, run, stored, reports } = await poll(clearinghouse, {
      profiles: { DEVEMS01: ['t1'], SHARED: ['t1', 't2'] },
      published: false
    });
    assert.deepEqual(
      downloads.map((q) => q.parameters.slice(3)),
      [
        [null, null, 'Not an X12 file'],
        [null, null, 'No agency has submitter ID SOMEONE'],
        [null, null, 'More than one agency has submitter ID SHARED'],
        ['t1', null, 'The billing.receive-payer-file workflow is not published']
      ]
    );
    assert.equal(run, undefined);
    assert.deepEqual([stored, removed], [[], []]);
    assert.equal(
      reports[0],
      'Clearinghouse: left /outbound/999/a.999 on the server: Not an X12 file'
    );
  });

  it('skips files it already downloaded in one lookup', async () => {
    const { db, queries } = createRecordingDb((q: CompiledQuery) =>
      q.sql.includes('from "clearinghouse_downloads"')
        ? [{ remote_path: file('a.999').path, size: 10, modified_at: file('a.999').modifiedAt }]
        : []
    );
    const { clearinghouse, removed } = fakeClearinghouse({ 'a.999': isa('DEVEMS01') });
    const boss: RunQueueClient = { insert: async () => undefined };
    const blobs = { putBytes: async () => assert.fail('should not store') };
    await createClearinghousePoll({ db, boss, blobs, clearinghouse, report: () => undefined })();
    assert.deepEqual(removed, []);
    assert.equal(queries.length, 1);
    await db.destroy();
  });

  it('reports a file it cannot receive and goes on to the next', async () => {
    const { clearinghouse } = fakeClearinghouse({
      'a.999': isa('DEVEMS01'),
      'b.999': isa('DEVEMS01')
    });
    const download = clearinghouse.download;
    clearinghouse.download = async (path) =>
      path.endsWith('a.999') ? Promise.reject(new Error('connection reset')) : download(path);
    const { jobs, reports } = await poll(clearinghouse);
    assert.equal(jobs.length, 1);
    assert.deepEqual(reports, [
      'Clearinghouse: could not receive /outbound/999/a.999: Error: connection reset',
      'Clearinghouse: received /outbound/999/b.999, run r1'
    ]);
  });
});
