import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  cancel,
  dropTimeout,
  enqueueRuns,
  RUN_QUEUE,
  type RunQueueClient,
  resume,
  retry,
  skip,
  start,
  timeout
} from './index.ts';

describe('run jobs', () => {
  it('build command payloads', () => {
    assert.deepEqual(advance('r'), { runId: 'r', command: { type: 'advance' } });
    assert.deepEqual(advance('r', null), advance('r'));
    assert.deepEqual(advance('r', 'p'), { runId: 'r', command: { type: 'advance' }, group: 'p' });
    assert.deepEqual(start('r'), { runId: 'r', command: { type: 'advance' }, interactive: true });
    assert.deepEqual(cancel('r'), { runId: 'r', command: { type: 'cancel' } });
    assert.deepEqual(retry('r'), { runId: 'r', command: { type: 'retry' } });
    assert.deepEqual(skip('r', 'then', { a: 1 }), {
      runId: 'r',
      command: { type: 'skip', pin: 'then', outputs: { a: 1 } }
    });
    assert.deepEqual(resume('r', '7', { ok: true }), {
      runId: 'r',
      command: { type: 'resume', suspensionId: '7', payload: { ok: true } }
    });
    assert.deepEqual(resume('r', '7', null, '2026-01-01'), {
      runId: 'r',
      command: { type: 'resume', suspensionId: '7', payload: null },
      startAfter: '2026-01-01'
    });
    assert.deepEqual(resume('r', '7', null, ''), resume('r', '7', null));
  });

  it('enqueue through the caller transaction, keep retrying commands other than advance, put immediate and person-started runs ahead of deferred ones, and skip empty batches', async () => {
    const calls: unknown[][] = [];
    const boss: RunQueueClient = { insert: async (...args) => void calls.push(args) };
    const db = { executeSql: async () => ({ rows: [] }) };
    await enqueueRuns(boss, db, []);
    await enqueueRuns(boss, db, [
      advance('a'),
      resume('b', '1', null, '2026-01-01'),
      advance('c', 'parent'),
      cancel('d'),
      timeout('e', '2', '2026-01-02'),
      start('f'),
      resume('g', '3', 1),
      retry('h'),
      skip('i', null, {})
    ]);
    assert.deepEqual(calls, [
      [
        RUN_QUEUE,
        [
          { data: { runId: 'a', command: { type: 'advance' } } },
          {
            data: { runId: 'b', command: { type: 'resume', suspensionId: '1', payload: null } },
            startAfter: '2026-01-01',
            retryLimit: 1_000_000,
            priority: 1
          },
          { data: { runId: 'c', command: { type: 'advance' } }, group: { id: 'parent' } },
          {
            data: { runId: 'd', command: { type: 'cancel' } },
            retryLimit: 1_000_000,
            priority: 2
          },
          {
            data: {
              runId: 'e',
              command: { type: 'resume', suspensionId: '2', payload: { timedOut: true } }
            },
            id: timeout('e', '2', '2026-01-02').id,
            startAfter: '2026-01-02',
            retryLimit: 1_000_000,
            priority: 1
          },
          { data: { runId: 'f', command: { type: 'advance' } }, priority: 2 },
          {
            data: { runId: 'g', command: { type: 'resume', suspensionId: '3', payload: 1 } },
            retryLimit: 1_000_000,
            priority: 2
          },
          { data: { runId: 'h', command: { type: 'retry' } }, retryLimit: 1_000_000, priority: 2 },
          {
            data: { runId: 'i', command: { type: 'skip', pin: null, outputs: {} } },
            retryLimit: 1_000_000,
            priority: 2
          }
        ],
        { db }
      ]
    ]);
  });

  it('gives each signal timeout a stable job id so a wake can delete it', async () => {
    const { id } = timeout('r', '7', '2026-01-01');
    assert.match(id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(timeout('r', '7', '2026-02-01').id, id);
    assert.notEqual(timeout('r', '8', '2026-01-01').id, id);
    assert.deepEqual(timeout('r', '7', '2026-01-01'), {
      ...resume('r', '7', { timedOut: true }, '2026-01-01'),
      id
    });
    const deleted: unknown[][] = [];
    const db = { executeSql: async () => ({ rows: [] }) };
    await dropTimeout({ deleteJob: async (...args) => void deleted.push(args) }, db, 'r', '7');
    assert.deepEqual(deleted, [[RUN_QUEUE, id, { db }]]);
  });
});
