import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { createBurst, createLive, type EventStream, isOnPage } from './live.ts';

const fakeStreams = () => {
  const opened: { url: string; closed: boolean; handlers: Parameters<EventStream['listen']>[0] }[] =
    [];
  const open = (url: string): EventStream => {
    const entry = { url, closed: false, handlers: {} as Parameters<EventStream['listen']>[0] };
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
  const timers: { run: () => void; ms: number }[] = [];
  const schedule = (run: () => void, ms: number) => {
    timers.push({ run, ms });
    return () => undefined;
  };
  return { opened, open, timers, schedule };
};

describe('createLive', () => {
  it('opens one stream lazily and fans valid events out to subscribers', () => {
    const { opened, open, schedule } = fakeStreams();
    const live = createLive('http://sse.test', { open, schedule });
    assert.equal(opened.length, 0);
    const seen: (LiveEvent | null)[] = [];
    const stop = live.subscribe((e) => seen.push(e));
    live.subscribe((e) => seen.push(e));
    const stream = opened[0];
    assert.equal(stream?.url, 'http://sse.test/events');
    stream?.handlers.onData('{"kind":"claim","id":"c1"}');
    stream?.handlers.onData('noise');
    stop();
    stream?.handlers.onData('{"kind":"import","id":null}');
    assert.equal(opened.length, 1);
    assert.deepEqual(seen, [
      { kind: 'claim', id: 'c1' },
      { kind: 'claim', id: 'c1' },
      { kind: 'import', id: null }
    ]);
    live.close();
    assert.equal(stream?.closed, true);
  });

  it('tracks the connection and asks for a full reload after a reconnect', () => {
    const { opened, open, schedule } = fakeStreams();
    const live = createLive('http://sse.test', { open, schedule });
    const statuses: string[] = [];
    live.onStatus(() => statuses.push(live.status()));
    const seen: (LiveEvent | null)[] = [];
    live.subscribe((e) => seen.push(e));
    assert.equal(live.status(), 'connecting');
    const { handlers } = opened[0] ?? {};
    handlers?.onOpen();
    handlers?.onError(false);
    handlers?.onOpen();
    assert.deepEqual(statuses, ['online', 'offline', 'online']);
    assert.deepEqual(seen, [null]);
  });

  it('reopens a stream the browser gave up on, backing off between attempts', () => {
    const { opened, open, timers, schedule } = fakeStreams();
    const live = createLive('http://sse.test', { open, schedule });
    live.subscribe(() => undefined);
    opened[0]?.handlers.onError(true);
    assert.equal(opened[0]?.closed, true);
    assert.equal(timers[0]?.ms, 1_000);
    timers[0]?.run();
    opened[1]?.handlers.onError(true);
    assert.equal(timers[1]?.ms, 5_000);
    timers[1]?.run();
    opened[2]?.handlers.onOpen();
    assert.equal(opened.length, 3);
    assert.equal(live.status(), 'online');
  });
});

describe('createBurst', () => {
  it('gathers a burst of pushes into one run after the delay', () => {
    const { timers, schedule } = fakeStreams();
    let runs = 0;
    const burst = createBurst(() => runs++, 1_500, schedule);
    burst.push();
    burst.push();
    assert.equal(timers.length, 1);
    assert.equal(timers[0]?.ms, 1_500);
    timers[0]?.run();
    assert.equal(runs, 1);
    burst.push();
    assert.equal(timers.length, 2);
  });
});

describe('isOnPage', () => {
  it('reloads a list for unknown ids, its first page, or a row it shows', () => {
    assert.equal(isOnPage(null, 3, []), true);
    assert.equal(isOnPage('c9', 1, []), true);
    assert.equal(isOnPage('c2', 2, ['c1', 'c2']), true);
    assert.equal(isOnPage('c9', 2, ['c1', null]), false);
  });
});
