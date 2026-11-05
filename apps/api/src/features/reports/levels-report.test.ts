import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { levelsReport } from './levels-report.ts';
import { compileReport } from './report-testing.ts';

describe('levelsReport', () => {
  it('sums trips, miles and charges by level and emergency, leaving drafts and voids out', async () => {
    const { rows, totals } = await compileReport(levelsReport);
    assert.ok(rows.sql.includes('group by "c"."level", "c"."emergency"'));
    assert.ok(rows.parameters.includes('draft') && rows.parameters.includes('void'));
    assert.ok(totals.sql.includes('"r"."miles"'));
  });
});
