import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import { createTaskService, fieldErrors, jobFor } from './service.ts';

const task = (patch: Record<string, unknown> = {}) => ({
  id: 't1',
  run_id: 'r1',
  wait_id: '7',
  kind: 'task',
  status: 'open',
  outcomes: ['approve', 'reject'],
  fields: [{ name: 'note', type: 'string' }],
  ...patch
});

const setup = (row: Record<string, unknown> | undefined, updated = true) => {
  const { db, queries } = createRecordingDb((q) =>
    q.sql.startsWith('select') ? (row ? [row] : []) : updated ? [{ id: 't1' }] : []
  );
  const jobs: unknown[] = [];
  const boss: JobBoss = { insert: async (_n, batch) => void jobs.push(...batch) };
  return { service: createTaskService({ db, boss }), jobs, queries };
};

describe('task service', () => {
  it('maps completions to run commands', () => {
    const base = { run_id: 'r1', wait_id: '7' };
    assert.deepEqual(
      jobFor({ ...base, kind: 'task' }, 'u1', { outcome: 'approve', values: { a: 1 } }).command,
      {
        type: 'resume',
        suspensionId: '7',
        payload: { outcome: 'approve', values: { a: 1 }, userId: 'u1' }
      }
    );
    assert.deepEqual(
      jobFor({ ...base, kind: 'fault' }, 'u1', { outcome: 'retry', values: {} }).command,
      { type: 'retry' }
    );
    assert.deepEqual(
      jobFor({ ...base, kind: 'fault' }, 'u1', {
        outcome: 'skip',
        values: { pin: 'then', outputs: { x: 1 } }
      }).command,
      { type: 'skip', pin: 'then', outputs: { x: 1 } }
    );
    assert.deepEqual(
      jobFor({ ...base, kind: 'fault' }, 'u1', { outcome: 'cancel', values: {} }).command,
      { type: 'cancel' }
    );
  });

  it('checks field values against their types', () => {
    assert.deepEqual(fieldErrors([{ name: 'n', type: 'integer' }], { n: 1.5 }), {
      n: 'expected integer, got number'
    });
    assert.deepEqual(
      fieldErrors([{ name: 'pin', type: 'string', options: [{ value: 'then', label: 'then' }] }], {
        pin: 'x'
      }),
      {
        pin: 'must be one of then'
      }
    );
    assert.deepEqual(fieldErrors(null, {}), {});
  });

  it('completes open tasks and resumes the run atomically', async () => {
    const { service, jobs } = setup(task());
    assert.deepEqual(
      await service.complete('t', 'u1', 't1', { outcome: 'approve', values: { note: 'ok' } }),
      { ok: true, value: { status: 'completed' } }
    );
    assert.equal(jobs.length, 1);
  });

  it('rejects unknown, closed, invalid and raced completions', async () => {
    const status = async (
      row: Record<string, unknown> | undefined,
      outcome = 'approve',
      values = {},
      updated = true
    ) => {
      const res = await setup(row, updated).service.complete('t', 'u1', 't1', { outcome, values });
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await status(undefined), 'not_found');
    assert.equal(await status(task({ status: 'completed' })), 'conflict');
    assert.equal(await status(task(), 'maybe'), 'invalid');
    assert.equal(await status(task(), 'approve', { note: 3 }), 'invalid');
    assert.equal(
      await status(
        task({ kind: 'fault', fields: [{ name: 'pin', type: 'string' }] }),
        'reject',
        {},
        true
      ),
      'ok'
    );
    assert.equal(await status(task(), 'approve', { note: 'x' }, false), 'conflict');
  });

  it('validates the pin and outputs of skipped faults only', async () => {
    const fault = task({
      kind: 'fault',
      outcomes: ['retry', 'skip', 'cancel'],
      fields: [
        { name: 'pin', type: 'string', options: [{ value: 'then', label: 'then' }] },
        { name: 'outputs', type: { object: {} } }
      ]
    });
    const code = async (outcome: string, values: Record<string, unknown>) => {
      const res = await setup(fault).service.complete('t', 'u1', 't1', {
        outcome,
        values: values as never
      });
      return res.ok ? 'ok' : res.failure.code;
    };
    assert.equal(await code('skip', { pin: 'nope' }), 'invalid');
    assert.equal(await code('skip', { pin: 'then', outputs: 'x' }), 'invalid');
    assert.equal(await code('skip', { pin: 'then', outputs: { a: 1 } }), 'ok');
    assert.equal(await code('retry', { pin: 'nope' }), 'ok');
  });

  it('reads, hands out and assigns tasks', async () => {
    const { service, queries } = setup(task());
    await service.next('t', 'billing', 'u1');
    assert.ok(queries[0]?.sql.includes('for update skip locked'));
    assert.deepEqual(await service.release('t', 't1'), { ok: true, value: { status: 'released' } });
    assert.deepEqual(await service.claim('t', 't1', 'u1'), {
      ok: true,
      value: { status: 'claimed' }
    });
    assert.equal((await service.find('t', 't1')).ok, true);
    assert.equal((await service.queues('t')).ok, true);
  });
});
