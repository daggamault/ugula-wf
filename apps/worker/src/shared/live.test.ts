import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LiveEvent } from '@ugula/live';
import { coalescePublish, createAnnouncer } from './live.ts';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

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
  it('publishes only the latest event per agency, kind and id once the window closes', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sent: [string, LiveEvent][] = [];
    const live = coalescePublish(async (t, e) => void sent.push([t, e]));
    await live.publish('t', { kind: 'run', id: 'r1', status: 'running', parentId: null });
    await live.publish('t', { kind: 'run', id: 'r1', status: 'suspended', parentId: null });
    await live.publish('t', { kind: 'task', id: null, runId: 'r1' });
    await live.publish('t', { kind: 'task', id: null, runId: 'r2' });
    await live.publish('u', { kind: 'claim', id: 'c1' });
    t.mock.timers.tick(249);
    await settle();
    assert.equal(sent.length, 0);
    t.mock.timers.tick(1);
    await settle();
    assert.deepEqual(sent, [
      ['t', { kind: 'run', id: 'r1', status: 'suspended', parentId: null }],
      ['t', { kind: 'task', id: null, runId: 'r1' }],
      ['t', { kind: 'task', id: null, runId: 'r2' }],
      ['u', { kind: 'claim', id: 'c1' }]
    ]);
    await live.publish('t', { kind: 'claim', id: 'c2' });
    await live.flush();
    assert.equal(sent.length, 5);
    t.mock.timers.tick(250);
    await settle();
    assert.equal(sent.length, 5);
  });

  it('opens a new window after one closes and keeps publishing past a failure', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const sent: string[] = [];
    const live = coalescePublish(async (_, e) => {
      if (e.id === 'bad') throw new Error('redis down');
      sent.push(String(e.id));
    }, 5);
    await live.publish('t', { kind: 'claim', id: 'bad' });
    await live.publish('t', { kind: 'claim', id: 'c1' });
    t.mock.timers.tick(5);
    await settle();
    assert.deepEqual(sent, ['c1']);
    await live.publish('t', { kind: 'claim', id: 'c2' });
    t.mock.timers.tick(4);
    await settle();
    assert.deepEqual(sent, ['c1']);
    t.mock.timers.tick(1);
    await settle();
    assert.deepEqual(sent, ['c1', 'c2']);
  });
});
