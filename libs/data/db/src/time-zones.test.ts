import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sql } from 'kysely';
import { createRecordingDb } from './testing.ts';
import { agencyTimeZone } from './time-zones.ts';

describe('agency time zones', () => {
  it("reads the billing profile's time zone for an agency, UTC without a profile", () => {
    const { db } = createRecordingDb();
    const q = db.selectNoFrom(agencyTimeZone('a1').as('zone')).compile();
    assert.equal(
      q.sql,
      'select coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = $1::uuid), \'UTC\') as "zone"'
    );
    assert.deepEqual(q.parameters, ['a1']);
  });

  it('takes the agency from a column', () => {
    const { db } = createRecordingDb();
    const q = db
      .selectFrom('claims as c')
      .select(agencyTimeZone(sql.ref('c.agency_id')).as('zone'))
      .compile();
    assert.equal(
      q.sql,
      'select coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = "c"."agency_id"), \'UTC\') as "zone" from "claims" as "c"'
    );
    assert.deepEqual(q.parameters, []);
  });
});
