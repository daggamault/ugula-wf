import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import {
  buildNotificationStatesTable,
  buildNotificationsIndexes,
  buildNotificationsTable
} from './notifications.ts';

describe('notifications tables', () => {
  it('keep a tenant feed, optionally for one user, and each user read and cleared marks', async () => {
    const db = createDummyDb();
    const table = buildNotificationsTable(db).compile().sql;
    assert.ok(table.includes('create table "notifications"'));
    assert.ok(table.includes('"user_id" uuid references "users" ("id") on delete cascade'));
    assert.ok(table.includes("link_to like '/%'"));
    const states = buildNotificationStatesTable(db).compile().sql;
    assert.ok(states.includes('"user_id" uuid primary key references "users" ("id")'));
    assert.ok(
      buildNotificationsIndexes(db)[0]?.compile().sql.includes('("tenant_id", "created_at" desc)')
    );
    await db.destroy();
  });
});
