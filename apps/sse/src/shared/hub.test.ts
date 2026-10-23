import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHub } from './hub.ts';

describe('createHub', () => {
  it('fans messages out per tenant, sends heartbeats and forgets closed clients', () => {
    const hub = createHub();
    const seen: string[] = [];
    const client = (name: string) => ({
      write: (chunk: string) => void seen.push(`${name}:${chunk}`)
    });
    const removeA = hub.add('t-1', client('a'));
    hub.add('t-2', client('b'));
    hub.broadcast('t-1', '{"id":1}');
    hub.beat();
    assert.deepEqual(seen, ['a:data: {"id":1}\n\n', 'a:: ping\n\n', 'b:: ping\n\n']);
    assert.equal(hub.size(), 2);
    removeA();
    hub.broadcast('t-1', 'x');
    assert.equal(hub.size(), 1);
    assert.equal(seen.length, 3);
  });
});
