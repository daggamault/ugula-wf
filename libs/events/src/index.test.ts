import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { channelOf, EVENTS_PATTERN, parseEvent, publishEvent, tenantOf } from './index.ts';

describe('live events', () => {
  it('scopes channels per tenant', () => {
    assert.equal(channelOf('t-1'), 'events:t-1');
    assert.equal(tenantOf('events:t-1'), 't-1');
    assert.equal(tenantOf('other:t-1'), null);
    assert.equal(EVENTS_PATTERN, 'events:*');
  });

  it('publishes and parses each kind of event defensively', async () => {
    const sent: string[][] = [];
    await publishEvent({ publish: async (...args) => void sent.push(args) }, 't-1', {
      kind: 'run',
      id: 'r1',
      status: 'completed',
      parentId: null
    });
    assert.deepEqual(sent, [
      ['events:t-1', '{"kind":"run","id":"r1","status":"completed","parentId":null}']
    ]);
    assert.deepEqual(parseEvent(sent[0]?.[1] ?? ''), {
      kind: 'run',
      id: 'r1',
      status: 'completed',
      parentId: null
    });
    assert.deepEqual(parseEvent('{"kind":"task","id":null,"runId":"r1"}'), {
      kind: 'task',
      id: null,
      runId: 'r1'
    });
    assert.deepEqual(parseEvent('{"kind":"claim","id":"c1"}'), { kind: 'claim', id: 'c1' });
    assert.deepEqual(parseEvent('{"kind":"import","id":null}'), { kind: 'import', id: null });
    assert.deepEqual(parseEvent('{"kind":"notification","id":"n1"}'), {
      kind: 'notification',
      id: 'n1'
    });
    assert.equal(parseEvent('{"kind":"run"}'), null);
    assert.equal(parseEvent('{"kind":"claim","id":7}'), null);
    assert.equal(parseEvent('{"kind":"toString","id":null}'), null);
    assert.equal(parseEvent('[]'), null);
    assert.equal(parseEvent('not json'), null);
  });
});
