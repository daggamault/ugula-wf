import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type {
  AfterDownload,
  Clearinghouse,
  ClearinghouseFile,
  ClearinghouseInbox
} from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunJob, RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import type { PollTarget } from '../../shared/clearinghouse.ts';
import { createClearinghousePoll, receiverOf } from './poll.ts';

const isa = (receiver: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${receiver.padEnd(15)}*261103*1200*^*00501*000000001*0*T*:~GS*FA~`;

const file = (name: string): ClearinghouseFile => ({
  path: `/outbound/999/${name}`,
  name,
  size: 10,
  modifiedAt: new Date('2026-11-03T12:00:00Z')
});

const fakeClearinghouse = (
  files: Record<string, string>,
  afterDownload: AfterDownload = 'delete'
) => {
  const removed: string[] = [];
  const sessions = { opened: 0 };
  const inbox: ClearinghouseInbox = {
    list: async () => Object.keys(files).map(file),
    download: async (path) => new TextEncoder().encode(files[path.split('/').at(-1) ?? ''] ?? ''),
    remove: async (path) => void removed.push(path)
  };
  const clearinghouse: Clearinghouse = {
    submitClaims: async (name) => name,
    submitEligibility: async (name) => name,
    submitClaimStatus: async (name) => name,
    checkEligibility: null,
    checkClaimStatus: null,
    afterDownload,
    inbox: (work) => {
      sessions.opened++;
      return work(inbox);
    }
  };
  return { clearinghouse, inbox, removed, sessions };
};

const SOURCE = 'sftp://u@localhost:2223/outbound/999';

const target = (clearinghouse: Clearinghouse, agencyIds: string[] | null = null): PollTarget => ({
  source: SOURCE,
  clearinghouse,
  agencyIds
});

type Seen = { run_id: string | null; note: string; tried_at?: Date };

const NOW = new Date('2026-11-05T12:00:00Z');

const LONG_AGO = new Date('2026-11-05T10:00:00Z');

const RECENTLY = new Date('2026-11-05T11:30:00Z');

type Directory = {
  profiles?: Record<string, string[]>;
  published?: boolean;
  owners?: string[] | null;
  seen?: Record<string, Seen>;
};

const poll = async (
  clearinghouse: Clearinghouse,
  { profiles = { DEVEMS01: ['t1'] }, published = true, owners = null, seen = {} }: Directory = {}
) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "billing_profiles"')) {
      const [receiver, ...allowed] = q.parameters.map(String);
      return (profiles[receiver ?? ''] ?? [])
        .filter((a) => !allowed.length || allowed.includes(a))
        .map((agency_id) => ({ agency_id }));
    }
    if (q.sql.startsWith('select') && q.sql.includes('from "clearinghouse_downloads"')) {
      return Object.entries(seen).map(([name, row]) => ({
        remote_path: file(name).path,
        size: 10,
        modified_at: file(name).modifiedAt,
        tried_at: LONG_AGO,
        ...row
      }));
    }
    if (q.sql.startsWith('insert into "clearinghouse_downloads"')) {
      const name = String(q.parameters[1]).split('/').at(-1) ?? '';
      return seen[name]?.run_id ? [] : [{ id: `d-${name}` }];
    }
    if (q.sql.includes('select v.version')) return published ? [{ version: 1 }] : [];
    if (q.sql.includes('from unnest')) return published ? [{ id: 'v1', version: 1 }] : [];
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
    targets: async () => [target(clearinghouse, owners)],
    report: (m) => reports.push(m),
    now: () => NOW
  })();
  await db.destroy();
  const downloads = queries.filter((q) =>
    q.sql.startsWith('insert into "clearinghouse_downloads"')
  );
  const linked = queries.filter((q) => q.sql.startsWith('update "clearinghouse_downloads"'));
  const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
  const routing = queries.filter((q) => q.sql.includes('from "billing_profiles"'));
  return { downloads, linked, run, jobs, stored, reports, routing };
};

describe('createClearinghousePoll', () => {
  it('starts a Receive Payer File run per new file for the agency it is addressed to', async () => {
    const { clearinghouse, removed, sessions } = fakeClearinghouse({ 'a.999': isa('DEVEMS01') });
    const { downloads, linked, run, jobs, stored, reports } = await poll(clearinghouse);
    assert.deepEqual(stored, [
      `clearinghouse/t1/${Date.parse('2026-11-03T12:00:00Z')}-${createHash('sha256').update('/outbound/999/a.999').digest('hex').slice(0, 8)}-a.999`
    ]);
    assert.ok(run?.parameters.includes('t1') && run.parameters.includes('v1'));
    assert.ok(
      run?.parameters.some((p) => typeof p === 'string' && p.includes('"fileName":"a.999"'))
    );
    assert.deepEqual(jobs, [{ runId: 'r1', command: { type: 'advance' } }]);
    assert.deepEqual(downloads[0]?.parameters.slice(0, 6), [
      SOURCE,
      '/outbound/999/a.999',
      10,
      new Date('2026-11-03T12:00:00Z'),
      't1',
      ''
    ]);
    assert.ok(downloads[0]?.sql.includes('where "clearinghouse_downloads"."run_id" is null'));
    assert.deepEqual(linked[0]?.parameters, ['r1', 'd-a.999']);
    assert.deepEqual(removed, ['/outbound/999/a.999']);
    assert.deepEqual(reports, ['Clearinghouse: received /outbound/999/a.999, run r1']);
    assert.equal(sessions.opened, 1);
  });

  it("routes files of an agency's own connection only to the agencies using it", async () => {
    const { clearinghouse } = fakeClearinghouse({
      'a.999': isa('DEVEMS01'),
      'b.999': isa('OTHER')
    });
    const { jobs, routing, downloads } = await poll(clearinghouse, {
      profiles: { DEVEMS01: ['t1'], OTHER: ['t2'] },
      owners: ['t1']
    });
    assert.equal(jobs.length, 1);
    assert.deepEqual(
      routing.map((q) => q.parameters),
      [
        ['DEVEMS01', 't1'],
        ['OTHER', 't1']
      ]
    );
    assert.deepEqual(downloads[1]?.parameters.slice(4, 6), [
      null,
      'No agency using this connection has submitter ID OTHER'
    ]);
  });

  it('tries again files it left on the server, saying so only when the reason changes', async () => {
    const { clearinghouse } = fakeClearinghouse({
      'a.999': isa('DEVEMS01'),
      'b.999': isa('SOMEONE'),
      'c.999': isa('NOBODY')
    });
    const { jobs, reports } = await poll(clearinghouse, {
      seen: {
        'a.999': { run_id: null, note: 'No agency has submitter ID DEVEMS01' },
        'b.999': { run_id: null, note: 'No agency has submitter ID SOMEONE' },
        'c.999': { run_id: null, note: 'Not an X12 file' }
      }
    });
    assert.equal(jobs.length, 1);
    assert.deepEqual(reports, [
      'Clearinghouse: received /outbound/999/a.999, run r1',
      'Clearinghouse: left /outbound/999/c.999 on the server: No agency has submitter ID NOBODY'
    ]);
  });

  it('waits an hour before trying a file it left on the server again', async () => {
    const { clearinghouse } = fakeClearinghouse({
      'a.999': isa('DEVEMS01'),
      'b.999': isa('DEVEMS01')
    });
    const { jobs, downloads } = await poll(clearinghouse, {
      seen: {
        'a.999': { run_id: null, note: 'No agency has submitter ID DEVEMS01', tried_at: RECENTLY },
        'b.999': { run_id: null, note: 'No agency has submitter ID DEVEMS01' }
      }
    });
    assert.equal(jobs.length, 1);
    assert.deepEqual(
      downloads.map((q) => q.parameters[1]),
      ['/outbound/999/b.999']
    );
    assert.ok(downloads[0]?.parameters.includes(NOW));
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
      downloads.map((q) => q.parameters.slice(4, 6)),
      [
        [null, 'Not an X12 file'],
        [null, 'No agency has submitter ID SOMEONE'],
        [null, 'More than one agency has submitter ID SHARED'],
        ['t1', 'The billing.receive-payer-file workflow is not published']
      ]
    );
    assert.equal(run, undefined);
    assert.deepEqual([stored, removed], [[], []]);
    assert.equal(
      reports[0],
      'Clearinghouse: left /outbound/999/a.999 on the server: Not an X12 file'
    );
  });

  it('skips files it already received in one lookup', async () => {
    const { db, queries } = createRecordingDb((q: CompiledQuery) =>
      q.sql.includes('from "clearinghouse_downloads"')
        ? [
            {
              remote_path: file('a.999').path,
              size: 10,
              modified_at: file('a.999').modifiedAt,
              run_id: 'r0',
              note: ''
            }
          ]
        : []
    );
    const { clearinghouse, removed } = fakeClearinghouse({ 'a.999': isa('DEVEMS01') });
    const boss: RunQueueClient = { insert: async () => undefined };
    const blobs = { putBytes: async () => assert.fail('should not store') };
    await createClearinghousePoll({
      db,
      boss,
      blobs,
      targets: async () => [target(clearinghouse)],
      report: () => undefined
    })();
    assert.deepEqual(removed, []);
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.parameters.includes(SOURCE));
    await db.destroy();
  });

  it('reports a file it cannot receive and goes on to the next', async () => {
    const { clearinghouse, inbox } = fakeClearinghouse({
      'a.999': isa('DEVEMS01'),
      'b.999': isa('DEVEMS01')
    });
    const download = inbox.download;
    inbox.download = async (path) =>
      path.endsWith('a.999') ? Promise.reject(new Error('connection reset')) : download(path);
    const { jobs, reports } = await poll(clearinghouse);
    assert.equal(jobs.length, 1);
    assert.deepEqual(reports, [
      'Clearinghouse: could not receive /outbound/999/a.999: Error: connection reset',
      'Clearinghouse: received /outbound/999/b.999, run r1'
    ]);
  });
});

describe('polling every connection', () => {
  it('polls each target and reports one that fails without stopping the others', async () => {
    const { db } = createRecordingDb(() => []);
    const reports: string[] = [];
    const broken = fakeClearinghouse({});
    broken.inbox.list = async () => Promise.reject(new Error('refused'));
    const polled: string[] = [];
    const working = fakeClearinghouse({});
    working.inbox.list = async () => {
      polled.push('second');
      return [];
    };
    await createClearinghousePoll({
      db,
      boss: { insert: async () => undefined },
      blobs: { putBytes: async () => assert.fail('nothing to store') },
      targets: async () => [
        { source: 'one', clearinghouse: broken.clearinghouse, agencyIds: null },
        { source: 'two', clearinghouse: working.clearinghouse, agencyIds: ['t1'] }
      ],
      report: (m) => reports.push(m)
    })();
    assert.deepEqual(polled, ['second']);
    assert.deepEqual(reports, ['Clearinghouse: could not poll one: Error: refused']);
    await db.destroy();
  });
});

describe('receiverOf', () => {
  const header = (receiver: string, separator = '*') =>
    ['ISA', '00', ' '.repeat(10), '00', ' '.repeat(10), 'ZZ', 'CLEARING'.padEnd(15), 'ZZ']
      .concat([receiver.padEnd(15), '261103', '1200', '^', '00501', '000000001', '0', 'T', ':~'])
      .join(separator);

  it('reads the interchange receiver with whatever element separator the file uses', () => {
    assert.equal(receiverOf(header('DEVEMS01')), 'DEVEMS01');
    assert.equal(receiverOf(`\n${header('DEVEMS01', '|')}GS|FA~`), 'DEVEMS01');
  });

  it('has no receiver for text that is not X12 or an interchange cut short', () => {
    assert.equal(receiverOf('not x12'), null);
    assert.equal(receiverOf(header('DEVEMS01').slice(0, 90)), null);
    assert.equal(receiverOf(header('')), null);
  });
});
