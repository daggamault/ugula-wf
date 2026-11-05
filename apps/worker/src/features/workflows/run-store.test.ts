import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { advance } from '@ugula/run-queue';
import { createRunStore } from './run-store.ts';
import type { QueueClient } from './run-tx.ts';

const recordingBoss = () => {
  const inserts: unknown[][] = [];
  const boss: QueueClient = {
    insert: async (_, jobs) => void inserts.push(jobs),
    deleteJob: async () => {}
  };
  return { boss, inserts };
};

const recordingDb = (rows: Record<string, unknown>[] = []) => createRecordingDb(() => rows);

describe('createRunStore', () => {
  it('only writes while holding the lease it claimed', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    const run = { id: 'r1', lease: 'l1' };
    await assert.rejects(
      () => store.transaction((tx) => tx.saveRun(run, { status: 'running', state: null })),
      /no longer leased/
    );
    await assert.rejects(() => store.checkpoint(run, {} as never, [], 1000), /no longer leased/);
    await assert.rejects(() => store.extend(run, 1000), /no longer leased/);
    await store.release(run, 'running');
    const fenced = queries.filter((q) => q.sql.startsWith('update'));
    assert.equal(fenced.length, 4);
    for (const q of fenced) {
      assert.ok(q.sql.includes('"lease_token" = $'));
      assert.ok(q.parameters.includes('l1'));
    }
    assert.ok(fenced[3]?.sql.includes('"lease_until" = now()'));
    await db.destroy();
  });

  it('maps claimed rows', async () => {
    const { db } = recordingDb([
      {
        id: 'r1',
        lease_token: 'l1',
        agency_id: 't1',
        graph_version_id: 'v1',
        parent_id: null,
        parent_wait: null,
        inputs: { a: 1 },
        state: null,
        graphs: [{ id: 'v1', key: 'demo.x', version: 1 }],
        tables: [{ id: 't1', key: 'demo.table' }]
      }
    ]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    assert.deepEqual(await store.claim(advance('r1'), 1000), {
      id: 'r1',
      lease: 'l1',
      agencyId: 't1',
      versionId: 'v1',
      parentId: null,
      parentWait: null,
      inputs: { a: 1 },
      state: null,
      graphs: [{ id: 'v1', key: 'demo.x', version: 1 }],
      tables: [{ id: 't1', key: 'demo.table' }]
    });
    await db.destroy();
  });

  it('claims nothing when no run matches the command', async () => {
    const { db } = recordingDb();
    assert.equal(
      await createRunStore({ db, boss: recordingBoss().boss }).claim(advance('r1'), 1000),
      undefined
    );
    await db.destroy();
  });

  it('reads the children of a wait outside a transaction', async () => {
    const { db, queries } = recordingDb([
      { id: 'c0', status: 'completed', result: null, error: null }
    ]);
    const store = createRunStore({ db, boss: recordingBoss().boss });
    assert.deepEqual(await store.children('p', '7'), [
      { id: 'c0', status: 'completed', result: null, error: null }
    ]);
    assert.deepEqual(queries[0]?.parameters, ['p', '7']);
    await db.destroy();
  });

  it('sweeps expired leases and stranded unleased runs back onto the queue', async () => {
    const { db, queries } = recordingDb([
      { id: 'r1', parent_id: null },
      { id: 'r2', parent_id: 'p' }
    ]);
    const { boss, inserts } = recordingBoss();
    assert.equal(await createRunStore({ db, boss }).sweep(), 2);
    const sweep = queries.find((q) => q.sql.startsWith('update "workflow_runs"'))?.sql ?? '';
    assert.ok(sweep.includes('"lease_until" < now()'));
    assert.ok(sweep.includes('"lease_until" is null and "updated_at" < now() - interval'));
    assert.deepEqual(inserts[0], [
      { data: { runId: 'r1', command: { type: 'advance' } } },
      { data: { runId: 'r2', command: { type: 'advance' } }, group: { id: 'p' } }
    ]);
    await db.destroy();
  });

  it('prunes old steps of long-lived active runs in bounded batches', async () => {
    const { db, queries } = recordingDb();
    assert.equal(await createRunStore({ db, boss: recordingBoss().boss }).prune(), 0);
    const sql = queries[0]?.sql ?? '';
    assert.ok(sql.startsWith('delete from "workflow_run_steps" as "s" where (s.run_id, s.seq) in'));
    assert.ok(sql.includes('"r"."status" in') && sql.includes('limit $'));
    await db.destroy();
  });
});
