import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agencyOf, channelOf, LIVE_PATTERN, parseLiveEvent, publishLiveEvent } from './index.ts';

describe('live events', () => {
  it('scopes channels per agency', () => {
    assert.equal(channelOf('t-1'), 'live:t-1');
    assert.equal(agencyOf('live:t-1'), 't-1');
    assert.equal(agencyOf('other:t-1'), null);
    assert.equal(LIVE_PATTERN, 'live:*');
  });

  it('publishes and parses each kind of event defensively', async () => {
    const sent: string[][] = [];
    await publishLiveEvent({ publish: async (...args) => void sent.push(args) }, 't-1', {
      kind: 'run',
      id: 'r1',
      status: 'completed',
      parentId: null
    });
    assert.deepEqual(sent, [
      ['live:t-1', '{"kind":"run","id":"r1","status":"completed","parentId":null}']
    ]);
    assert.deepEqual(parseLiveEvent(sent[0]?.[1] ?? ''), {
      kind: 'run',
      id: 'r1',
      status: 'completed',
      parentId: null
    });
    assert.deepEqual(parseLiveEvent('{"kind":"task","id":null,"runId":"r1"}'), {
      kind: 'task',
      id: null,
      runId: 'r1'
    });
    assert.deepEqual(parseLiveEvent('{"kind":"claim","id":"c1"}'), { kind: 'claim', id: 'c1' });
    assert.deepEqual(parseLiveEvent('{"kind":"import","id":null}'), { kind: 'import', id: null });
    assert.deepEqual(parseLiveEvent('{"kind":"payerFile","id":"f1"}'), {
      kind: 'payerFile',
      id: 'f1'
    });
    assert.deepEqual(parseLiveEvent('{"kind":"notification","id":"n1"}'), {
      kind: 'notification',
      id: 'n1'
    });
    assert.deepEqual(parseLiveEvent('{"kind":"run","id":"r2","status":"failed","extra":1}'), {
      kind: 'run',
      id: 'r2',
      status: 'failed',
      parentId: null
    });
    assert.deepEqual(parseLiveEvent('{"kind":"task","id":"t1"}'), {
      kind: 'task',
      id: 't1',
      runId: null
    });
    assert.equal(parseLiveEvent('{"kind":"run"}'), null);
    assert.equal(parseLiveEvent('{"kind":"run","id":"r1","status":"ok","parentId":3}'), null);
    assert.equal(parseLiveEvent('{"kind":"claim"}'), null);
    assert.equal(parseLiveEvent('{"id":"c1"}'), null);
    assert.equal(parseLiveEvent('null'), null);
    assert.equal(parseLiveEvent('{"kind":"claim","id":7}'), null);
    assert.equal(parseLiveEvent('{"kind":"toString","id":null}'), null);
    assert.equal(parseLiveEvent('[]'), null);
    assert.equal(parseLiveEvent('not json'), null);
  });
});
