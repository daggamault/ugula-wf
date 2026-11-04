import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { coalescePublish, createAnnouncer } from './live.ts';

describe('createAnnouncer', () => {
  it("publishes to the run's agency and never throws", async () => {
    const sent: [string, LiveEvent][] = [];
    const event: LiveEvent = { kind: 'claim', id: 'c1' };
    const agencyOf = async (runId: string) => (runId === 'gone' ? undefined : 't-1');
    await createAnnouncer(agencyOf, async (agencyId, e) => void sent.push([agencyId, e]))(
      'r1',
      event
    );
    assert.deepEqual(sent, [['t-1', event]]);
    await createAnnouncer(agencyOf, async () => {
      throw new Error('redis down');
    })('r1', event);
    await createAnnouncer(
      async () => Promise.reject(new Error('db down')),
      async (t, e) => void sent.push([t, e])
    )('r1', event);
    await createAnnouncer(agencyOf, async (t, e) => void sent.push([t, e]))('gone', event);
    assert.equal(sent.length, 1);
  });
});

describe('coalescePublish', () => {
  it('publishes only the latest event per agency, kind and id once the window closes', async () => {
    const sent: [string, LiveEvent][] = [];
    const live = coalescePublish(async (t, e) => void sent.push([t, e]), 5);
    await live.publish('t', { kind: 'run', id: 'r1', status: 'running', parentId: null });
    await live.publish('t', { kind: 'run', id: 'r1', status: 'suspended', parentId: null });
    await live.publish('t', { kind: 'task', id: null, runId: 'r1' });
    await live.publish('t', { kind: 'task', id: null, runId: 'r2' });
    await live.publish('u', { kind: 'claim', id: 'c1' });
    assert.equal(sent.length, 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(sent, [
      ['t', { kind: 'run', id: 'r1', status: 'suspended', parentId: null }],
      ['t', { kind: 'task', id: null, runId: 'r1' }],
      ['t', { kind: 'task', id: null, runId: 'r2' }],
      ['u', { kind: 'claim', id: 'c1' }]
    ]);
    await live.publish('t', { kind: 'claim', id: 'c2' });
    await live.flush();
    assert.equal(sent.length, 5);
  });
});
