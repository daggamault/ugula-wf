import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkHandler } from 'pg-boss';
import { HEALTH_QUEUE, registerHealthJob } from './job.ts';

describe('registerHealthJob', () => {
  const register = async () => {
    const calls: string[] = [];
    let handler: WorkHandler<unknown> | undefined;
    const id = await registerHealthJob({
      createQueue: async (name: string) => void calls.push(`createQueue:${name}`),
      work: async <T>(name: string, h: WorkHandler<T>) => {
        calls.push(`work:${name}`);
        handler = h as WorkHandler<unknown>;
        return 'health-worker';
      }
    });
    return { calls, id, handler };
  };

  it('creates the health queue before working it and returns the worker id', async () => {
    const { calls, id } = await register();
    assert.deepEqual(calls, [`createQueue:${HEALTH_QUEUE}`, `work:${HEALTH_QUEUE}`]);
    assert.equal(id, 'health-worker');
  });

  it('answers status ok', async () => {
    const { handler } = await register();
    assert.deepEqual(await handler?.([]), { status: 'ok' });
  });
});
