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

  it('publishes and parses run events defensively', async () => {
    const sent: string[][] = [];
    await publishEvent({ publish: async (...args) => void sent.push(args) }, 't-1', {
      kind: 'run',
      id: 'r1',
      status: 'completed'
    });
    assert.deepEqual(sent, [['events:t-1', '{"kind":"run","id":"r1","status":"completed"}']]);
    assert.deepEqual(parseEvent(sent[0]?.[1] ?? ''), {
      kind: 'run',
      id: 'r1',
      status: 'completed'
    });
    assert.equal(parseEvent('{"kind":"run"}'), null);
    assert.equal(parseEvent('not json'), null);
  });
});
