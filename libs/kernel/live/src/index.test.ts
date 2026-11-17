import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agencyOf, LIVE_PATTERN, parseLiveEvent, publishLiveEvent } from './index.ts';

describe('live channels', () => {
  it('reads the agency from a live channel and ignores other channels', () => {
    assert.equal(LIVE_PATTERN, 'live:*');
    assert.equal(agencyOf('live:t-1'), 't-1');
    assert.equal(agencyOf('live:'), '');
    assert.equal(agencyOf('other:t-1'), null);
    assert.equal(agencyOf('t-1:live:'), null);
  });

  it('publishes an event as JSON on the agency channel', async () => {
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
  });
});

describe('parseLiveEvent', () => {
  it('parses each kind of event', () => {
    assert.deepEqual(
      parseLiveEvent('{"kind":"run","id":"r1","status":"completed","parentId":"p1"}'),
      {
        kind: 'run',
        id: 'r1',
        status: 'completed',
        parentId: 'p1'
      }
    );
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
  });

  it('defaults a missing parent or run to null and drops unknown fields', () => {
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
  });

  it('rejects events whose fields have the wrong type', () => {
    for (const message of [
      '{"kind":"run"}',
      '{"kind":"run","id":"r1"}',
      '{"kind":"run","id":null,"status":"ok"}',
      '{"kind":"run","id":"r1","status":"ok","parentId":3}',
      '{"kind":"task","id":1}',
      '{"kind":"task","id":"t1","runId":2}',
      '{"kind":"claim"}',
      '{"kind":"claim","id":7}',
      '{"kind":"import","id":7}',
      '{"kind":"payerFile","id":false}',
      '{"kind":"notification","id":{}}'
    ]) {
      assert.equal(parseLiveEvent(message), null, message);
    }
  });

  it('rejects messages that are not an object of a known kind', () => {
    for (const message of [
      '{"id":"c1"}',
      '{"kind":"toString","id":null}',
      '{"kind":3,"id":null}',
      'null',
      '[]',
      '"claim"',
      '7',
      'not json',
      ''
    ]) {
      assert.equal(parseLiveEvent(message), null, message);
    }
  });
});
