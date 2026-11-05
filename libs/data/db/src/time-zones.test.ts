import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sql } from 'kysely';
import { createRecordingDb } from './testing.ts';
import { agencyTimeZone, agencyToday, findTimeZone } from './time-zones.ts';

describe('agency time zones', () => {
  it("reads the billing profile's time zone, UTC without a profile", async () => {
    const zoned = createRecordingDb(() => [{ zone: 'America/Chicago' }]);
    assert.equal(await findTimeZone(zoned.db, 'a1'), 'America/Chicago');
    assert.ok(zoned.queries[0]?.sql.includes("where bp.agency_id = $1::uuid), 'UTC')"));
    assert.deepEqual(zoned.queries[0]?.parameters, ['a1']);
    assert.equal(await findTimeZone(createRecordingDb(() => []).db, 'a1'), 'UTC');
  });

  it("dates a moment by the agency's calendar, not UTC", async () => {
    const at = new Date('2026-11-01T03:30:00Z');
    const chicago = createRecordingDb(() => [{ zone: 'America/Chicago' }]).db;
    assert.equal(await agencyToday(chicago, 'a1', at), '2026-10-31');
    const tokyo = createRecordingDb(() => [{ zone: 'Asia/Tokyo' }]).db;
    assert.equal(await agencyToday(tokyo, 'a1', new Date('2026-10-31T16:00:00Z')), '2026-11-01');
  });

  it('takes the agency from a column', () => {
    const { db } = createRecordingDb();
    const q = db
      .selectFrom('claims as c')
      .select(agencyTimeZone(sql.ref('c.agency_id')).as('zone'))
      .compile();
    assert.ok(q.sql.includes('where bp.agency_id = "c"."agency_id"'));
  });
});
