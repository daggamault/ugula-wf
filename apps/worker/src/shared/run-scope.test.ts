import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRunScope } from './run-scope.ts';

describe('createRunScope', () => {
  it('knows the agency of the run it is working and nothing else', async () => {
    const scope = createRunScope();
    const signal = new AbortController().signal;
    assert.equal(scope.agencyOf('r1'), undefined);
    await scope.within({ runId: 'r1', agencyId: 't', signal }, async () => {
      assert.equal(scope.agencyOf('r1'), 't');
      assert.equal(scope.agencyOf('r2'), undefined);
    });
  });

  it('refuses port calls and aborts fetches once the lease is lost', async () => {
    const scope = createRunScope();
    const calls: string[] = [];
    const store = scope.guard({ save: async (id: string) => void calls.push(id), limit: 3 });
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetch = scope.fetch(async (_input, init) => {
      signals.push(init?.signal);
      return new Response('ok');
    });
    await store.save('outside');
    await fetch('http://x');
    const lease = new AbortController();
    await scope.within({ runId: 'r1', agencyId: 't', signal: lease.signal }, async () => {
      await store.save('held');
      await fetch('http://x', { signal: AbortSignal.timeout(60_000) });
      lease.abort(new Error('lease lost'));
      await assert.rejects(async () => store.save('lost'), /lease lost/);
    });
    assert.deepEqual(calls, ['outside', 'held']);
    assert.equal(store.limit, 3);
    assert.equal(signals[0], undefined);
    assert.equal(signals[1]?.aborted, true);
  });
});
