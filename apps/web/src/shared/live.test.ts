import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createElement } from 'react';
import {
  createBurst,
  createLive,
  type EventStream,
  isOnPage,
  type Live,
  useLive,
  useLiveStatus,
  useReconnect
} from './live.ts';
import { act, render, screen, waitFor } from './testing-dom.ts';

type Handlers = Parameters<EventStream['listen']>[0];

const fakeStreams = () => {
  const opened: { url: string; closed: boolean; handlers: Handlers }[] = [];
  const open = (url: string): EventStream => {
    const entry = { url, closed: false, handlers: {} as Handlers };
    opened.push(entry);
    return {
      listen: (handlers) => {
        entry.handlers = handlers;
      },
      close: () => {
        entry.closed = true;
      }
    };
  };
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule = (run: () => void, ms: number) => {
    const timer = { run, ms, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return { opened, open, timers, schedule };
};

const liveOf = (agencyId?: string) => {
  const fake = fakeStreams();
  const live = createLive('http://sse.test', {
    ...(agencyId ? { agencyId } : {}),
    open: fake.open,
    schedule: fake.schedule
  });
  return { ...fake, live };
};

const handlersOf = (opened: { handlers: Handlers }[], i: number) => {
  const handlers = opened[i]?.handlers;
  assert.ok(handlers, `stream ${i} was not opened`);
  return handlers;
};

describe('createLive', () => {
  it('asks the stream for the events of one agency', () => {
    const { live, opened } = liveOf('a 1');
    live.subscribe(() => undefined);
    assert.deepEqual(
      opened.map((s) => s.url),
      ['http://sse.test/events?agency=a%201']
    );
  });

  it('asks for all events without an agency', () => {
    const { live, opened } = liveOf();
    live.subscribe(() => undefined);
    assert.deepEqual(
      opened.map((s) => s.url),
      ['http://sse.test/events']
    );
  });

  it('opens no stream until someone subscribes or watches the status', () => {
    const { live, opened } = liveOf();
    assert.equal(opened.length, 0);
    live.onStatus(() => undefined);
    assert.equal(opened.length, 1);
  });

  it('shares one stream among all subscribers', () => {
    const { live, opened } = liveOf();
    live.subscribe(() => undefined);
    live.subscribe(() => undefined);
    live.onStatus(() => undefined);
    assert.equal(opened.length, 1);
  });

  it('fans valid events out to every subscriber', () => {
    const { live, opened } = liveOf();
    const seen: string[] = [];
    live.subscribe((e) => seen.push(`a ${JSON.stringify(e)}`));
    live.subscribe((e) => seen.push(`b ${JSON.stringify(e)}`));
    handlersOf(opened, 0).onData('{"kind":"claim","id":"c1"}');
    assert.deepEqual(seen, ['a {"kind":"claim","id":"c1"}', 'b {"kind":"claim","id":"c1"}']);
  });

  it('drops data that is not a live event', () => {
    const { live, opened } = liveOf();
    const seen: (LiveEvent | null)[] = [];
    live.subscribe((e) => seen.push(e));
    handlersOf(opened, 0).onData('noise');
    handlersOf(opened, 0).onData('{"kind":42}');
    assert.deepEqual(seen, []);
  });

  it('stops sending events to a subscriber that left', () => {
    const { live, opened } = liveOf();
    const seen: (LiveEvent | null)[] = [];
    const stop = live.subscribe((e) => seen.push(e));
    stop();
    handlersOf(opened, 0).onData('{"kind":"import","id":null}');
    assert.deepEqual(seen, []);
  });

  it('starts connecting and reports each change of the connection once', () => {
    const { live, opened } = liveOf();
    const statuses: string[] = [];
    live.onStatus(() => statuses.push(live.status()));
    assert.equal(live.status(), 'connecting');
    const handlers = handlersOf(opened, 0);
    handlers.onOpen();
    handlers.onOpen();
    handlers.onError(false);
    handlers.onError(false);
    handlers.onOpen();
    assert.deepEqual(statuses, ['online', 'offline', 'online']);
  });

  it('stops reporting status to a watcher that left', () => {
    const { live, opened } = liveOf();
    let calls = 0;
    const stop = live.onStatus(() => {
      calls += 1;
    });
    stop();
    handlersOf(opened, 0).onOpen();
    assert.equal(calls, 0);
  });

  it('asks subscribers for a full reload only after reconnecting from an error', () => {
    const { live, opened } = liveOf();
    const seen: (LiveEvent | null)[] = [];
    live.subscribe((e) => seen.push(e));
    const handlers = handlersOf(opened, 0);
    handlers.onOpen();
    assert.deepEqual(seen, []);
    handlers.onError(false);
    handlers.onOpen();
    handlers.onOpen();
    assert.deepEqual(seen, [null]);
  });

  it('keeps a stream the browser is still retrying', () => {
    const { live, opened, timers } = liveOf();
    live.subscribe(() => undefined);
    handlersOf(opened, 0).onError(false);
    assert.deepEqual([opened[0]?.closed, timers.length, live.status()], [false, 0, 'offline']);
  });

  it('reopens a stream the browser gave up on, backing off between attempts', () => {
    const { live, opened, timers } = liveOf();
    live.subscribe(() => undefined);
    handlersOf(opened, 0).onError(true);
    assert.equal(opened[0]?.closed, true);
    assert.deepEqual(
      timers.map((t) => t.ms),
      [1_000]
    );
    timers[0]?.run();
    handlersOf(opened, 1).onError(true);
    timers[1]?.run();
    handlersOf(opened, 2).onOpen();
    assert.deepEqual(
      timers.map((t) => t.ms),
      [1_000, 5_000]
    );
    assert.equal(opened.length, 3);
    assert.equal(live.status(), 'online');
  });

  it('caps the back-off at thirty seconds', () => {
    const { live, opened, timers } = liveOf();
    live.subscribe(() => undefined);
    for (let i = 0; i < 6; i++) {
      handlersOf(opened, i).onError(true);
      timers[i]?.run();
    }
    assert.deepEqual(
      timers.map((t) => t.ms),
      [1_000, 5_000, 15_000, 30_000, 30_000, 30_000]
    );
  });

  it('starts the back-off over once a stream opens', () => {
    const { live, opened, timers } = liveOf();
    live.subscribe(() => undefined);
    handlersOf(opened, 0).onError(true);
    timers[0]?.run();
    handlersOf(opened, 1).onError(true);
    timers[1]?.run();
    handlersOf(opened, 2).onOpen();
    handlersOf(opened, 2).onError(true);
    assert.deepEqual(
      timers.map((t) => t.ms),
      [1_000, 5_000, 1_000]
    );
  });

  it('ignores errors from a stream it already replaced', () => {
    const { live, opened, timers } = liveOf();
    live.subscribe(() => undefined);
    handlersOf(opened, 0).onError(true);
    timers[0]?.run();
    handlersOf(opened, 0).onError(true);
    assert.deepEqual([timers.length, opened[1]?.closed], [1, false]);
  });

  it('closes the stream and cancels a pending retry when closed', () => {
    const { live, opened, timers } = liveOf();
    live.subscribe(() => undefined);
    handlersOf(opened, 0).onError(true);
    live.close();
    assert.equal(timers[0]?.cancelled, true);
    timers.length = 0;
    live.subscribe(() => undefined);
    handlersOf(opened, 1).onOpen();
    live.close();
    assert.equal(opened[1]?.closed, true);
    handlersOf(opened, 1).onError(true);
    assert.deepEqual(timers, []);
  });
});

describe('createBurst', () => {
  it('gathers a burst of pushes into one run after the delay', () => {
    const { timers, schedule } = fakeStreams();
    let runs = 0;
    const burst = createBurst(() => runs++, 1_500, schedule);
    burst.push();
    burst.push();
    assert.deepEqual(
      timers.map((t) => t.ms),
      [1_500]
    );
    assert.equal(runs, 0);
    timers[0]?.run();
    assert.equal(runs, 1);
  });

  it('waits again for a push after a run', () => {
    const { timers, schedule } = fakeStreams();
    const burst = createBurst(() => undefined, 1_500, schedule);
    burst.push();
    timers[0]?.run();
    burst.push();
    assert.equal(timers.length, 2);
  });

  it('drops a pending run when stopped and tolerates stopping twice', () => {
    const { timers, schedule } = fakeStreams();
    const burst = createBurst(() => undefined, 250, schedule);
    burst.push();
    burst.stop();
    burst.stop();
    assert.equal(timers[0]?.cancelled, true);
    burst.push();
    assert.equal(timers.length, 2);
  });
});

describe('isOnPage', () => {
  it('reloads a list for an event without an id', () => {
    assert.equal(isOnPage(null, 3, []), true);
  });

  it('reloads the first page for any event', () => {
    assert.equal(isOnPage('c9', 1, []), true);
  });

  it('reloads a later page only for a row it shows', () => {
    assert.equal(isOnPage('c2', 2, ['c1', 'c2']), true);
    assert.equal(isOnPage('c9', 2, ['c1', null]), false);
  });
});

const fakeLive = () => {
  const listeners = new Set<(event: LiveEvent | null) => void>();
  const watchers = new Set<() => void>();
  let status: ReturnType<Live['status']> = 'connecting';
  const live: Live = {
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    status: () => status,
    onStatus: (w) => {
      watchers.add(w);
      return () => void watchers.delete(w);
    },
    close: () => undefined
  };
  return {
    live,
    listeners,
    send: (event: LiveEvent | null) => {
      for (const l of listeners) l(event);
    },
    setStatus: (next: typeof status) => {
      status = next;
      for (const w of watchers) w();
    }
  };
};

const claim = (id: string) => ({ kind: 'claim', id }) as LiveEvent;

describe('useLive', () => {
  const Probe = ({ live, kind, reload }: { live: Live; kind: string; reload: () => void }) => {
    useLive(live, (e) => e.kind === kind, reload, 5);
    return null;
  };

  it('reloads once for a burst of matching events', async () => {
    const { live, send } = fakeLive();
    const reloads: string[] = [];
    render(createElement(Probe, { live, kind: 'claim', reload: () => reloads.push('reload') }));
    send(claim('c1'));
    send(claim('c2'));
    await waitFor(() => assert.deepEqual(reloads, ['reload']));
  });

  it('reloads for a reconnect but not for events that do not match', async () => {
    const { live, send } = fakeLive();
    const reloads: string[] = [];
    render(createElement(Probe, { live, kind: 'import', reload: () => reloads.push('reload') }));
    send(claim('c1'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(reloads, []);
    send(null);
    await waitFor(() => assert.deepEqual(reloads, ['reload']));
  });

  it('uses the latest filter and reload without subscribing again', async () => {
    const { live, send, listeners } = fakeLive();
    const reloads: string[] = [];
    const { rerender } = render(
      createElement(Probe, { live, kind: 'import', reload: () => reloads.push('old') })
    );
    rerender(createElement(Probe, { live, kind: 'claim', reload: () => reloads.push('new') }));
    assert.equal(listeners.size, 1);
    send(claim('c1'));
    await waitFor(() => assert.deepEqual(reloads, ['new']));
  });

  it('unsubscribes and drops a pending reload on unmount', async () => {
    const { live, send, listeners } = fakeLive();
    const reloads: string[] = [];
    const { unmount } = render(
      createElement(Probe, { live, kind: 'claim', reload: () => reloads.push('reload') })
    );
    send(claim('c1'));
    unmount();
    assert.equal(listeners.size, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(reloads, []);
  });
});

describe('useReconnect', () => {
  it('reloads only after a reconnect', async () => {
    const { live, send } = fakeLive();
    const reloads: string[] = [];
    const Probe = () => {
      useReconnect(live, () => reloads.push('reload'));
      return null;
    };
    render(createElement(Probe));
    send(claim('c1'));
    send(null);
    await waitFor(() => assert.deepEqual(reloads, ['reload']));
  });
});

describe('useLiveStatus', () => {
  it('shows the connection status and follows its changes', () => {
    const { live, setStatus } = fakeLive();
    const Probe = () => createElement('output', null, useLiveStatus(live));
    render(createElement(Probe));
    assert.equal(screen.getByRole('status').textContent, 'connecting');
    act(() => setStatus('online'));
    assert.equal(screen.getByRole('status').textContent, 'online');
  });
});
