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
    const own = new AbortController();
    await scope.within({ runId: 'r1', agencyId: 't', signal: lease.signal }, async () => {
      await store.save('held');
      await fetch('http://x', { signal: own.signal });
      await fetch('http://x');
      lease.abort(new Error('lease lost'));
      await assert.rejects(async () => store.save('lost'), /lease lost/);
    });
    assert.deepEqual(calls, ['outside', 'held']);
    assert.equal(store.limit, 3);
    assert.equal(signals[0], undefined);
    assert.equal(signals[1]?.aborted, true);
    assert.match(String(signals[1]?.reason), /lease lost/);
    assert.equal(signals[2], lease.signal);
    assert.equal(own.signal.aborted, false);
  });

  it("keeps the caller's own fetch signal alongside the lease", async () => {
    const scope = createRunScope();
    let signal: AbortSignal | null | undefined;
    let method: string | undefined;
    const fetch = scope.fetch(async (_input, init) => {
      signal = init?.signal;
      method = init?.method;
      return new Response('ok');
    });
    const own = new AbortController();
    const lease = new AbortController();
    await scope.within({ runId: 'r1', agencyId: 't', signal: lease.signal }, async () => {
      await fetch('http://x', { signal: own.signal, method: 'POST' });
    });
    assert.equal(method, 'POST');
    assert.equal(signal?.aborted, false);
    own.abort(new Error('caller gave up'));
    assert.equal(signal?.aborted, true);
    assert.match(String(signal?.reason), /caller gave up/);
    assert.equal(lease.signal.aborted, false);
  });
});
