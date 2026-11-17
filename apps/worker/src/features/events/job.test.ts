import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_BATCH, startEventDispatcher } from './job.ts';

const dispatcher = (batches: number[], fail = false) => {
  const calls: number[] = [];
  const reports: string[] = [];
  let notify: () => void = () => {};
  const listening = { stopped: false };
  const events = startEventDispatcher({
    dispatch: async (limit) => {
      calls.push(limit);
      if (fail) throw new Error('database down');
      return { events: batches.shift() ?? 0, started: 0 };
    },
    listen: (onNotify) => {
      notify = onNotify;
      return {
        stop: async () => {
          listening.stopped = true;
        }
      };
    },
    report: (m) => reports.push(m),
    sweepMs: 60_000
  });
  return { events, calls, reports, listening, notify: () => notify() };
};

describe('startEventDispatcher', () => {
  it('dispatches at once, and keeps going while batches come back full', async () => {
    const { events, calls } = dispatcher([EVENT_BATCH, EVENT_BATCH, 3]);
    await events.drained();
    assert.deepEqual(calls, [EVENT_BATCH, EVENT_BATCH, EVENT_BATCH]);
    await events.stop();
  });

  it('dispatches again when notified, once more if notified while busy', async () => {
    const { events, calls, notify } = dispatcher([]);
    await events.drained();
    notify();
    notify();
    await events.drained();
    assert.equal(calls.length, 3);
    await events.stop();
  });

  it('reports a failed dispatch and tries again on the next notice', async () => {
    const { events, calls, reports, notify } = dispatcher([], true);
    await events.drained();
    notify();
    await events.drained();
    assert.equal(calls.length, 2);
    assert.deepEqual(reports, [
      'Dispatching events failed: Error: database down',
      'Dispatching events failed: Error: database down'
    ]);
    await events.stop();
  });

  it('stops listening and dispatches nothing after stopping', async () => {
    const { events, calls, listening, notify } = dispatcher([]);
    await events.stop();
    notify();
    await events.drained();
    assert.equal(calls.length, 1);
    assert.ok(listening.stopped);
  });
});
