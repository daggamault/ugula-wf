import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publishAfter } from './live.ts';
import { fail, ok } from './result.ts';
import { recordAnnouncements } from './testing.ts';

describe('publishAfter', () => {
  it('announces the events of a committed write to its agency', async () => {
    const { publish, events } = recordAnnouncements();
    const res = await publishAfter(publish, 't-1', Promise.resolve(ok({ id: 'c1' })), ({ id }) => [
      { kind: 'claim', id }
    ]);
    assert.deepEqual(res, ok({ id: 'c1' }));
    assert.deepEqual(events, [{ agencyId: 't-1', event: { kind: 'claim', id: 'c1' } }]);
  });

  it('announces nothing for a failed write', async () => {
    const { publish, events } = recordAnnouncements();
    const res = await publishAfter(publish, 't-1', Promise.resolve(fail('conflict', 'No')), () => [
      { kind: 'claim', id: null }
    ]);
    assert.deepEqual(res, fail('conflict', 'No'));
    assert.deepEqual(events, []);
  });

  it('never fails the request when an announcement is lost', async () => {
    const res = await publishAfter(
      async () => Promise.reject(new Error('redis down')),
      't-1',
      Promise.resolve(ok({ id: 'c1' })),
      ({ id }) => [{ kind: 'claim', id }]
    );
    assert.deepEqual(res, ok({ id: 'c1' }));
  });
});
