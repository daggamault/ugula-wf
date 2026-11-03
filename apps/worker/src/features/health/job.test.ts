import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WorkHandler } from 'pg-boss';
import { HEALTH_QUEUE, registerHealthJob } from './job.ts';

describe('registerHealthJob', () => {
  it('registers the health queue with a handler that answers ok', async () => {
    let created = '';
    let handler: WorkHandler<unknown> | undefined;
    const boss = {
      createQueue: async (name: string) => {
        created = name;
      },
      work: async <T>(_: string, h: WorkHandler<T>) => {
        handler = h as WorkHandler<unknown>;
        return 'health-worker';
      }
    };

    const id = await registerHealthJob(boss);
    assert.equal(created, HEALTH_QUEUE);
    assert.equal(id, 'health-worker');
    assert.deepEqual(await handler?.([]), { status: 'ok' });
  });
});
