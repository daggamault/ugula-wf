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

  it('writes a broadcast as an SSE data frame to every client of the agency', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    hub.add('t-1', client('a'));
    hub.add('t-1', client('b'));
    hub.broadcast('t-1', '{"id":1}');
    assert.deepEqual(seen, ['a:data: {"id":1}\n\n', 'b:data: {"id":1}\n\n']);
  });

  it('only reaches clients of the broadcast agency', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    hub.add('t-1', client('a'));
    hub.add('t-2', client('b'));
    hub.broadcast('t-1', '1');
    hub.broadcast('t-2', '2');
    assert.deepEqual(seen, ['a:data: 1\n\n', 'b:data: 2\n\n']);
  });

  it('ignores a broadcast to an agency with no clients', () => {
    const hub = createHub();
    const seen: string[] = [];
    hub.add('t-1', recorder(seen)('a'));
    hub.broadcast('t-2', '1');
    assert.deepEqual(seen, []);
  });

  it('stops writing to a removed client but keeps its siblings', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    const removeA = hub.add('t-1', client('a'));
    hub.add('t-1', client('b'));
    removeA();
    hub.broadcast('t-1', 'x');
    assert.deepEqual(seen, ['b:data: x\n\n']);
  });

  it('drops a client that is not keeping up so it reconnects, without writing to it', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    hub.add('t-1', client('slow', true));
    hub.add('t-1', client('fast'));
    hub.broadcast('t-1', '1');
    hub.broadcast('t-1', '2');
    assert.deepEqual(seen, ['slow:destroyed', 'fast:data: 1\n\n', 'fast:data: 2\n\n']);
  });

  it('accepts a new client for an agency whose only client was dropped', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = recorder(seen);
    hub.add('t-1', client('slow', true));
    hub.broadcast('t-1', '1');
    hub.add('t-1', client('next'));
    hub.broadcast('t-1', '2');
    assert.deepEqual(seen, ['slow:destroyed', 'next:data: 2\n\n']);
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
    assert.deepEqual(seen, ['b:data: 1\n\n']);
  });
});
