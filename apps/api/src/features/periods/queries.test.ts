import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { searchPeriods } from './queries.ts';

describe('searchPeriods', () => {
  it('pages the agency closed periods with who closed them', async () => {
    const { db, queries } = createRecordingDb(() => [{ period_on: '2026-10-01', total: '1' }]);
    assert.deepEqual(
      await searchPeriods(db, 't-1', { page: 1, pageSize: 25, sort: 'period', dir: 'desc' }),
      { items: [{ period_on: '2026-10-01' }], total: 1, page: 1, pageSize: 25 }
    );
    assert.equal(
      queries[0]?.sql,
      'select "p"."period_on", "p"."closed_at", "u"."email" as "closed_by", count(*) over () as "total" from "accounting_periods" as "p" left join "users" as "u" on "u"."id" = "p"."closed_by_id" where "p"."agency_id" = $1 order by "p"."period_on" desc nulls last, "p"."period_on" desc limit $2 offset $3'
    );
  });
});
