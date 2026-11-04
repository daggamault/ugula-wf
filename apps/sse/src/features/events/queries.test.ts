import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { isActiveMember } from './queries.ts';

describe('isActiveMember', () => {
  it('requires an active user, agency and organization, and platform, owner or membership access', async () => {
    let rows: unknown[] = [{ id: 'u-1' }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.equal(await isActiveMember(db, 'u-1', 'a-1'), true);
    const sql = queries[0]?.sql ?? '';
    for (const part of [
      '"u"."is_active" = $',
      '"a"."is_active" = $',
      '"o"."is_active" = $',
      '"a"."organization_id" = "u"."organization_id"',
      '"u"."is_owner" = $',
      'exists (select "m"."id" from "memberships" as "m" where "m"."user_id" = "u"."id" and "m"."agency_id" = "a"."id")'
    ]) {
      assert.ok(sql.includes(part), part);
    }
    assert.ok(queries[0]?.parameters.includes('u-1') && queries[0].parameters.includes('a-1'));
    assert.equal(queries[0]?.parameters.filter((p) => p === 'platform').length, 2);
    rows = [];
    assert.equal(await isActiveMember(db, 'u-1', 'a-1'), false);
    await db.destroy();
  });
});
