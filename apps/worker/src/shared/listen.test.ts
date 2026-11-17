import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createListen } from './listen.ts';

type Handler = (arg?: unknown) => void;

const fakeClient = (failConnect = false) => {
  const handlers = new Map<string, Handler>();
  const state = { queries: [] as string[], ended: 0 };
  return {
    state,
    emit: (event: string, arg?: unknown) => handlers.get(event)?.(arg),
    client: {
      connect: async () => {
        if (failConnect) throw new Error('refused');
      },
      query: async (text: string) => void state.queries.push(text),
      on: (event: string, handler: Handler) => void handlers.set(event, handler),
      end: async () => void state.ended++
    }
  };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('createListen', () => {
  it('listens on the channel and wakes on connect and on every notification', async () => {
    const fake = fakeClient();
    let woken = 0;
    const listener = createListen({
      client: () => fake.client,
      channel: 'workflow_events',
      report: () => undefined,
      retryMs: 1
    })(() => woken++);
    await tick();
    assert.deepEqual(fake.state.queries, ['listen "workflow_events"']);
    assert.equal(woken, 1);
    fake.emit('notification');
    assert.equal(woken, 2);
    await listener.stop();
    assert.equal(fake.state.ended, 1);
  });

  it('reports a lost connection and connects again', async () => {
    const clients = [fakeClient(true), fakeClient()];
    const used: number[] = [];
    const reports: string[] = [];
    let woken = 0;
    const listener = createListen({
      client: () => {
        const next = clients[used.length];
        used.push(used.length);
        if (!next) throw new Error('no more clients');
        return next.client;
      },
      channel: 'c',
      report: (m) => reports.push(m),
      retryMs: 1
    })(() => woken++);
    await tick();
    await tick();
    assert.deepEqual(used, [0, 1]);
    assert.deepEqual(reports, ['Listening for c failed: Error: refused']);
    assert.equal(woken, 1);
    await listener.stop();
  });
});
