import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Job } from 'pg-boss';
import { createGatedWork, type SlotBoss } from './gated-work.ts';

const fakeBoss = () => {
  const live = new Set<string>();
  const stopping = new Map<string, () => void>();
  const handlers = new Map<string, (jobs: Job<unknown>[]) => Promise<unknown>>();
  let next = 0;
  const boss: SlotBoss = {
    work: async (_, options, handler) => {
      assert.deepEqual(options, { localConcurrency: 1, batchSize: 1 });
      const id = `w${next++}`;
      live.add(id);
      handlers.set(id, handler as (jobs: Job<unknown>[]) => Promise<unknown>);
      return id;
    },
    offWork: (_, { id, wait }) => {
      assert.equal(wait, true);
      live.delete(id);
      return new Promise<void>((resolve) => stopping.set(id, resolve));
    }
  };
  return { boss, live, stopping, handlers };
};

const tick = () => new Promise((r) => setImmediate(r));

describe('createGatedWork', () => {
  it('keeps one single-job slot per unit of concurrency while load allows', async () => {
    const { boss, live, handlers } = fakeBoss();
    const handled: unknown[] = [];
    const work = createGatedWork({
      boss,
      queue: 'q',
      concurrency: 3,
      handler: async (jobs) => handled.push(...jobs.map((j) => j.data)),
      gate: () => ({ open: true, reason: null }),
      report: () => undefined
    });
    await work.start();
    work.stop();
    assert.deepEqual([...live], ['w0', 'w1', 'w2']);
    await handlers.get('w1')?.([{ data: 'job' } as Job<unknown>]);
    assert.deepEqual(handled, ['job']);
  });

  it('stops claiming while overloaded, counts draining slots, and resumes with room', async () => {
    const { boss, live, stopping } = fakeBoss();
    const reports: string[] = [];
    const states = [true, false, false, true, true];
    const work = createGatedWork({
      boss,
      queue: 'q',
      concurrency: 2,
      handler: async () => undefined,
      gate: () => {
        const open = states.shift() ?? true;
        return { open, reason: open ? null : 'event loop 97% over 90%' };
      },
      report: (m) => reports.push(m)
    });
    await work.tick();
    assert.equal(live.size, 2);
    await work.tick();
    assert.equal(live.size, 0);
    assert.deepEqual([...stopping.keys()], ['w0', 'w1']);
    await work.tick();
    assert.equal(stopping.size, 2);
    await work.tick();
    assert.equal(live.size, 0);
    stopping.get('w0')?.();
    await tick();
    await work.tick();
    assert.deepEqual([...live], ['w2']);
    assert.deepEqual(reports, [
      'Not taking q jobs while event loop 97% over 90%',
      'Taking q jobs again'
    ]);
  });

  it('reports scheduling failures instead of throwing from the timer', async () => {
    const reports: string[] = [];
    const work = createGatedWork({
      boss: {
        work: async () => {
          throw new Error('pg-boss is stopped');
        },
        offWork: async () => undefined
      },
      queue: 'q',
      concurrency: 1,
      handler: async () => undefined,
      gate: () => ({ open: true, reason: null }),
      report: (m) => reports.push(m)
    });
    await work.tick();
    assert.deepEqual(reports, ['Scheduling q slots failed: Error: pg-boss is stopped']);
  });
});
