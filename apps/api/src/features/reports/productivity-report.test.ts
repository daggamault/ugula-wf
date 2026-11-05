import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { productivityReport } from './productivity-report.ts';
import { compileReport } from './report-testing.ts';

describe('productivityReport', () => {
  it('credits completed tasks, submissions and postings to the user who did them', async () => {
    const { rows } = await compileReport(productivityReport);
    assert.ok(rows.sql.includes('"t"."completed_by" is not null'));
    assert.ok(rows.sql.includes('"e"."created_by" is not null'));
    assert.ok(rows.sql.includes('inner join "users" as "u" on "u"."id" = "f"."user_id"'));
    assert.ok(rows.sql.includes('"t"."completed_at" >= ('));
    assert.ok(rows.sql.includes('group by "u"."email"'));
  });
});
