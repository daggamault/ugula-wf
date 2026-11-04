import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { isActiveMember } from './queries.ts';

describe('isActiveMember', () => {
  it('requires an active user in an active agency', async () => {
    let rows: unknown[] = [{ id: 'u-1' }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.equal(await isActiveMember(db, 'u-1', 't-1'), true);
    const [check] = queries;
    assert.ok(check?.sql.includes('"users"."is_active" = $'));
    assert.ok(check?.sql.includes('"agencies"."is_active" = $'));
    assert.deepEqual(check?.parameters.slice(0, 2), ['u-1', 't-1']);
    rows = [];
    assert.equal(await isActiveMember(db, 'u-1', 't-1'), false);
    await db.destroy();
  });
});
