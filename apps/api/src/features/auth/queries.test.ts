import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findActiveUserByEmail, isActiveMember } from './queries.ts';

describe('findActiveUserByEmail', () => {
  it('matches the email case-insensitively among active users of active agencies', async () => {
    const user = { id: 'u-1', agency_id: 't-1', email: 'dev@example.com', password_hash: 'h' };
    const { db, queries } = createRecordingDb(() => [user]);
    assert.deepEqual(await findActiveUserByEmail(db, 'Dev@Example.COM'), user);
    const [find] = queries;
    assert.ok(find?.sql.includes('lower(users.email) = $1'));
    assert.ok(find?.sql.includes('"users"."is_active" = $2'));
    assert.ok(find?.sql.includes('"agencies"."is_active" = $3'));
    assert.deepEqual(find?.parameters, ['dev@example.com', true, true]);
    await db.destroy();
  });

  it('finds nobody when no active user has the email', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findActiveUserByEmail(db, 'nobody@example.com'), undefined);
    await db.destroy();
  });
});

describe('isActiveMember', () => {
  it('requires an active user of the session agency in an active agency', async () => {
    let rows: unknown[] = [{ id: 'u-1' }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.equal(await isActiveMember(db, 'u-1', 't-1'), true);
    const [check] = queries;
    assert.ok(check?.sql.includes('"users"."agency_id" = $2'));
    assert.deepEqual(check?.parameters, ['u-1', 't-1', true, true]);
    rows = [];
    assert.equal(await isActiveMember(db, 'u-1', 't-2'), false);
    await db.destroy();
  });
});
