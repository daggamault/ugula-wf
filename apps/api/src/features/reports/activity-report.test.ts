import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityReport } from './activity-report.ts';
import { compileReport } from './report-testing.ts';

describe('activityReport', () => {
  it('books monthly activity from first submissions, payments and closings', async () => {
    const { rows } = await compileReport(activityReport);
    assert.ok(rows.sql.includes('(f.created_at, f.id) < (e.created_at, e.id)'));
    assert.equal(rows.sql.match(/union all/g)?.length, 2);
    assert.ok(rows.sql.includes('group by "f"."month"'));
  });
});
