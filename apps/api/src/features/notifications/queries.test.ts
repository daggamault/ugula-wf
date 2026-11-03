import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { insertNotification, listNotifications, markState } from './queries.ts';

describe('notification queries', () => {
  it('list the tenant feed and the user own messages since they last cleared', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listNotifications(db, 't', 'u');
    const [list] = queries;
    assert.ok(list?.sql.includes('("n"."user_id" is null or "n"."user_id" = $'));
    assert.ok(list?.sql.includes('s.cleared_at is null or n.created_at > s.cleared_at'));
    assert.ok(list?.sql.includes('order by "n"."created_at" desc, "n"."id" desc limit $'));
    assert.deepEqual(list?.parameters, ['u', 't', 'u', 50]);
    await db.destroy();
  });

  it('record personal messages and read or cleared marks per user', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'n1' }]);
    assert.deepEqual(
      await insertNotification(db, 't', 'u', {
        intent: 'success',
        title: 'Fee saved',
        description: null,
        link: { label: 'Open', to: '/fees' }
      }),
      { id: 'n1' }
    );
    await insertNotification(db, 't', 'u', {
      intent: 'info',
      title: 'Plain',
      description: 'x',
      link: null
    });
    await markState(db, 'u', false);
    await markState(db, 'u', true);
    assert.deepEqual(queries[0]?.parameters, [
      't',
      'u',
      'success',
      'Fee saved',
      null,
      'Open',
      '/fees'
    ]);
    assert.deepEqual(queries[1]?.parameters.slice(-2), [null, null]);
    assert.ok(queries[2]?.sql.includes('on conflict ("user_id") do update set "read_at" = now()'));
    assert.ok(!queries[2]?.sql.includes('"cleared_at" = now()'));
    assert.ok(queries[3]?.sql.includes('"cleared_at" = now()'));
    await db.destroy();
  });
});
