import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  cancel,
  enqueueRuns,
  type JobBoss,
  RUN_QUEUE,
  resume,
  retry,
  skip
} from './index.ts';

describe('run jobs', () => {
  it('build command payloads', () => {
    assert.deepEqual(advance('r'), { runId: 'r', command: { type: 'advance' } });
    assert.deepEqual(cancel('r').command, { type: 'cancel' });
    assert.deepEqual(retry('r').command, { type: 'retry' });
    assert.deepEqual(skip('r', 'then', { a: 1 }).command, {
      type: 'skip',
      pin: 'then',
      outputs: { a: 1 }
    });
    assert.deepEqual(resume('r', '7', { ok: true }), {
      runId: 'r',
      command: { type: 'resume', suspensionId: '7', payload: { ok: true } }
    });
    assert.equal(resume('r', '7', null, '2026-01-01').startAfter, '2026-01-01');
  });

  it('enqueue through the caller transaction and skip empty batches', async () => {
    const calls: unknown[][] = [];
    const boss: JobBoss = { insert: async (...args) => void calls.push(args) };
    const db = { executeSql: async () => ({ rows: [] }) };
    await enqueueRuns(boss, db, []);
    await enqueueRuns(boss, db, [advance('a'), resume('b', '1', null, '2026-01-01')]);
    assert.deepEqual(calls, [
      [
        RUN_QUEUE,
        [
          { data: { runId: 'a', command: { type: 'advance' } } },
          {
            data: { runId: 'b', command: { type: 'resume', suspensionId: '1', payload: null } },
            startAfter: '2026-01-01'
          }
        ],
        { db }
      ]
    ]);
  });
});
