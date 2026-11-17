import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findAgencyTimeZone, findReport, REPORTS } from './queries.ts';
import { compileReport } from './testing.ts';

const scoped = (sql: string) => sql.match(/"agency_id" = \$\d+/g)?.length ?? 0;

const parts = (sql: string) => (sql.match(/union all/g)?.length ?? 0) + 1;

describe('report queries', () => {
  it('offers every report by its id', () => {
    assert.deepEqual(Object.keys(REPORTS), [
      'aging',
      'unbilled',
      'monthly',
      'activity',
      'payments',
      'denials',
      'write-offs',
      'payers',
      'hcpcs',
      'levels',
      'work-queue',
      'productivity',
      'imports'
    ]);
  });

  it('scopes every part of every report and grouping to the agency', async () => {
    for (const [id, report] of Object.entries(REPORTS)) {
      for (const group of report.groups ?? ['']) {
        const { rows, totals } = await compileReport(report, group);
        for (const q of [rows, totals]) {
          assert.equal(scoped(q.sql), parts(q.sql), `${id} ${group}`);
          assert.equal(
            q.parameters.filter((p) => p === 't-1').length,
            parts(q.sql),
            `${id} ${group}`
          );
        }
      }
    }
  });

  it('finds reports by their own id only', () => {
    assert.equal(findReport('aging'), REPORTS.aging);
    assert.equal(findReport('write-offs'), REPORTS['write-offs']);
    assert.equal(findReport('toString'), undefined);
    assert.equal(findReport('nope'), undefined);
  });

  it("reads the agency's billing time zone", async () => {
    const { db, queries } = createRecordingDb(() => [{ time_zone: 'America/Denver' }]);
    assert.equal(await findAgencyTimeZone(db, 't-1'), 'America/Denver');
    assert.equal(
      queries[0]?.sql,
      'select "time_zone" from "billing_profiles" where "agency_id" = $1'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1']);
  });

  it('has no time zone for an agency without a billing profile or zone', async () => {
    assert.equal(await findAgencyTimeZone(createRecordingDb(() => []).db, 't-1'), null);
    assert.equal(
      await findAgencyTimeZone(createRecordingDb(() => [{ time_zone: null }]).db, 't-1'),
      null
    );
  });
});
