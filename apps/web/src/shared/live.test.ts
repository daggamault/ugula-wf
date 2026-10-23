import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLive, type EventStream } from './live.ts';

describe('createLive', () => {
  it('opens one stream lazily and fans valid events out to subscribers', () => {
    const opened: string[] = [];
    let closed = 0;
    let emit: (data: string) => void = () => undefined;
    const source: EventStream = {
      listen: (onData) => {
        emit = onData;
      },
      close: () => void closed++
    };
    const live = createLive('http://sse.test', (url) => {
      opened.push(url);
      return source;
    });
    assert.deepEqual(opened, []);
    const seen: string[] = [];
    const stop = live.subscribe((e) => seen.push(`a:${e.id}`));
    live.subscribe((e) => seen.push(`b:${e.status}`));
    emit('{"kind":"run","id":"r1","status":"completed"}');
    emit('noise');
    stop();
    emit('{"kind":"run","id":"r2","status":"running"}');
    assert.deepEqual(opened, ['http://sse.test/events']);
    assert.deepEqual(seen, ['a:r1', 'b:completed', 'b:running']);
    live.close();
    assert.equal(closed, 1);
  });
});
