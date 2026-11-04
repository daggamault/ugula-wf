import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHub } from './hub.ts';

describe('createHub', () => {
  const recorder =
    (seen: string[]) =>
    (name: string, needDrain = false) => ({
      writableNeedDrain: needDrain,
      write: (chunk: string) => void seen.push(`${name}:${chunk}`),
      destroy: () => void seen.push(`${name}:destroyed`)
    });

  it('fans messages out per agency and forgets closed clients', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    const removeA = hub.add('t-1', client('a'));
    hub.add('t-2', client('b'));
    hub.broadcast('t-1', '{"id":1}');
    hub.broadcast('t-2', '{"id":2}');
    removeA();
    hub.broadcast('t-1', 'x');
    assert.deepEqual(seen, ['a:data: {"id":1}\n\n', 'b:data: {"id":2}\n\n']);
  });

  it('drops clients that are not keeping up so they reconnect', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    hub.add('t-1', client('slow', true));
    hub.add('t-1', client('fast'));
    hub.broadcast('t-1', '1');
    hub.broadcast('t-1', '2');
    assert.deepEqual(seen, ['slow:destroyed', 'fast:data: 1\n\n', 'fast:data: 2\n\n']);
  });

  it('keeps a reconnected agency when a stale client is removed twice', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    const removeA = hub.add('t-1', client('a'));
    removeA();
    hub.add('t-1', client('b'));
    removeA();
    hub.broadcast('t-1', '1');
    hub.broadcast('t-2', '2');
    assert.deepEqual(seen, ['b:data: 1\n\n']);
  });
});
