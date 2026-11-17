import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { insertNotification, listNotifications, markState } from './queries.ts';

describe('listNotifications', () => {
  it('lists the newest 50 of the agency feed and the user own messages since they last cleared', async () => {
    const row = { id: 'n1', title: 'Fee saved', read: false };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await listNotifications(db, 't', 'u'), [row]);
    assert.equal(
      queries[0]?.sql,
      'select "n"."id", "n"."intent", "n"."title", "n"."description", "n"."link_label", "n"."link_to", "n"."created_at", s.read_at is not null and n.created_at <= s.read_at as "read" from "notifications" as "n" left join "notification_states" as "s" on "s"."user_id" = $1 and "s"."agency_id" = $2 where "n"."agency_id" = $3 and ("n"."user_id" is null or "n"."user_id" = $4) and (s.cleared_at is null or n.created_at > s.cleared_at) order by "n"."created_at" desc, "n"."id" desc limit $5'
    );
    assert.deepEqual(queries[0]?.parameters, ['u', 't', 't', 'u', 50]);
    await db.destroy();
  });
});

describe('insertNotification', () => {
  it('records a personal message with its link', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'n1' }]);
    const created = await insertNotification(db, 't', 'u', {
      intent: 'success',
      title: 'Fee saved',
      description: null,
      link: { label: 'Open', to: '/fees' }
    });
    assert.deepEqual(created, { id: 'n1' });
    assert.equal(
      queries[0]?.sql,
      'insert into "notifications" ("agency_id", "user_id", "intent", "title", "description", "link_label", "link_to") values ($1, $2, $3, $4, $5, $6, $7) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      't',
      'u',
      'success',
      'Fee saved',
      null,
      'Open',
      '/fees'
    ]);
    await db.destroy();
  });

  it('records a message without a link', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'n2' }]);
    await insertNotification(db, 't', 'u', {
      intent: 'info',
      title: 'Plain',
      description: 'x',
      link: null
    });
    assert.deepEqual(queries[0]?.parameters, ['t', 'u', 'info', 'Plain', 'x', null, null]);
    await db.destroy();
  });

  it('fails when the insert returns nothing', async () => {
    const { db } = createRecordingDb();
    const plain = { intent: 'info', title: 'Plain', description: null, link: null } as const;
    await assert.rejects(insertNotification(db, 't', 'u', plain), { message: 'no result' });
    await db.destroy();
  });
});

describe('markState', () => {
  it('marks the feed read for the user in the agency', async () => {
    const { db, queries } = createRecordingDb();
    await markState(db, 't', 'u', false);
    assert.equal(
      queries[0]?.sql,
      'insert into "notification_states" ("user_id", "agency_id", "read_at", "cleared_at") values ($1, $2, now(), $3) on conflict ("user_id", "agency_id") do update set "read_at" = now()'
    );
    assert.deepEqual(queries[0]?.parameters, ['u', 't', null]);
    await db.destroy();
  });

  it('marks the feed read and cleared', async () => {
    const { db, queries } = createRecordingDb();
    await markState(db, 't', 'u', true);
    assert.equal(
      queries[0]?.sql,
      'insert into "notification_states" ("user_id", "agency_id", "read_at", "cleared_at") values ($1, $2, now(), now()) on conflict ("user_id", "agency_id") do update set "read_at" = now(), "cleared_at" = now()'
    );
    assert.deepEqual(queries[0]?.parameters, ['u', 't']);
    await db.destroy();
  });
});
