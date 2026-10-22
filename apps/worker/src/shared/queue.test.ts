import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerQueue } from './queue.ts';

describe('registerQueue', () => {
  it('creates queue and attaches worker handler', async () => {
    const calls: string[] = [];
    const boss = {
      createQueue: async (name: string) => {
        calls.push(`create:${name}`);
      },
      work: async (name: string) => {
        calls.push(`work:${name}`);
        return 'worker-1';
      }
    };

    const id = await registerQueue(boss, 'test-queue', async () => undefined);
    assert.equal(id, 'worker-1');
    assert.deepEqual(calls, ['create:test-queue', 'work:test-queue']);
  });
});
