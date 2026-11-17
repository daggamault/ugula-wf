import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createHealthRecorder } from './health.ts';

const NOW = new Date('2026-11-05T12:00:00Z');
const BEFORE = new Date('2026-11-05T11:00:00Z');
const EARLIER = new Date('2026-11-05T10:00:00Z');

type Row = { agency_id: string; last_polled_at: Date | null; last_error_at: Date | null };

const healthy = (agency_id: string): Row => ({
  agency_id,
  last_polled_at: BEFORE,
  last_error_at: EARLIER
});

const failing = (agency_id: string): Row => ({
  agency_id,
  last_polled_at: EARLIER,
  last_error_at: BEFORE
});

const record = async (
  rows: Row[],
  error: string | null,
  agencyIds: string[] | null = rows.map((r) => r.agency_id)
) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "agency_id", "last_polled_at"')) return rows;
    if (q.sql.startsWith('insert into "events"')) return [{ id: `e${queries.length}` }];
    if (q.sql.includes('from "workflow_runs"')) return [{ id: 'r1', wait_id: 'w1' }];
    return [];
  });
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_, xs) => void jobs.push(...xs) };
  await createHealthRecorder({ db, boss })(
    { connection: 'sftp.example.com:22', agencyIds },
    { at: NOW, error }
  );
  await db.destroy();
  const of = (prefix: string) => queries.filter((q) => q.sql.startsWith(prefix));
  return {
    reads: of('select "agency_id"'),
    updates: of('update "clearinghouse_connections"'),
    events: of('insert into "events"').map((q) => [
      q.parameters[0],
      q.parameters[1],
      q.parameters[2]
    ]),
    signals: of('insert into "signals"').map((q) => q.parameters),
    jobs
  };
};

describe('createHealthRecorder', () => {
  it('records a good poll and says nothing while the connection keeps working', async () => {
    const { reads, updates, events, signals } = await record([healthy('t1')], null);
    assert.ok(reads[0]?.sql.endsWith('for update'));
    assert.equal(
      updates[0]?.sql,
      'update "clearinghouse_connections" set "last_polled_at" = $1 where "agency_id" in ($2)'
    );
    assert.deepEqual(updates[0]?.parameters, [NOW, 't1']);
    assert.deepEqual(events, []);
    assert.deepEqual(signals, []);
  });

  it('emits Clearinghouse Failed for each agency whose working connection fails', async () => {
    const { updates, events } = await record(
      [
        healthy('t1'),
        failing('t2'),
        { agency_id: 't3', last_polled_at: null, last_error_at: null }
      ],
      'All configured authentication methods failed'
    );
    assert.equal(
      updates[0]?.sql,
      'update "clearinghouse_connections" set "last_error" = $1, "last_error_at" = $2 where "agency_id" in ($3, $4, $5)'
    );
    const payload = JSON.stringify({
      connection: 'sftp.example.com:22',
      error: 'All configured authentication methods failed'
    });
    assert.deepEqual(events, [
      ['t1', 'clearinghouse.failed', payload],
      ['t3', 'clearinghouse.failed', payload]
    ]);
  });

  it('emits Clearinghouse Recovered and signals waiting runs when a failing connection works again', async () => {
    const { events, signals, jobs } = await record([failing('t1'), healthy('t2')], null);
    assert.deepEqual(events, [
      ['t1', 'clearinghouse.recovered', JSON.stringify({ connection: 'sftp.example.com:22' })]
    ]);
    assert.deepEqual(signals, [['t1', 'clearinghouse:recovered', 1]]);
    assert.equal(jobs.length, 1);
  });

  it('keeps a long error short and an empty one readable', async () => {
    const long = await record([healthy('t1')], 'x'.repeat(600));
    assert.equal(String(long.updates[0]?.parameters[0]).length, 500);
    const empty = await record([healthy('t1')], '');
    assert.equal(empty.updates[0]?.parameters[0], 'Unknown error');
  });

  it('records nothing for the server default or a connection removed meanwhile', async () => {
    const fallback = await record([healthy('t1')], 'refused', null);
    assert.deepEqual(fallback.reads, []);
    const removed = await record([], 'refused', ['t1']);
    assert.deepEqual(removed.updates, []);
  });
});
