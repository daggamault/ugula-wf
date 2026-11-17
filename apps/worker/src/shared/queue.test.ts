import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerQueue } from './queue.ts';

describe('registerQueue', () => {
  it('creates the queue before attaching the handler and returns the worker id', async () => {
    const calls: string[] = [];
    let attached: unknown;
    const boss = {
      createQueue: async (name: string) => {
        calls.push(`create:${name}`);
      },
      work: async (name: string, handler: unknown) => {
        calls.push(`work:${name}`);
        attached = handler;
        return 'worker-1';
      }
    };
    const handler = async () => undefined;
    const id = await registerQueue(boss, 'test-queue', handler);
    assert.equal(id, 'worker-1');
    assert.deepEqual(calls, ['create:test-queue', 'work:test-queue']);
    assert.equal(attached, handler);
  });
});
