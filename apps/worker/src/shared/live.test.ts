import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import type { LiveEvent } from '@ugula/events';
import { createAnnouncer } from './live.ts';

describe('createAnnouncer', () => {
  it("publishes to the run's tenant and never throws", async () => {
    const sent: [string, LiveEvent][] = [];
    const event: LiveEvent = { kind: 'claim', id: 'c1' };
    const { db } = createRecordingDb(() => [{ tenant_id: 't-1' }]);
    await createAnnouncer(db, async (tenantId, e) => void sent.push([tenantId, e]))('r1', event);
    assert.deepEqual(sent, [['t-1', event]]);

    const failing = createAnnouncer(db, async () => {
      throw new Error('redis down');
    });
    await failing('r1', event);
    const { db: empty } = createRecordingDb(() => []);
    await createAnnouncer(empty, async (t, e) => void sent.push([t, e]))('gone', event);
    assert.equal(sent.length, 1);
    await db.destroy();
    await empty.destroy();
  });
});
