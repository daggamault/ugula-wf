import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport } from './report-testing.ts';
import { writeOffsReport } from './write-offs-report.ts';

describe('writeOffsReport', () => {
  it('lists write-offs and collections by the day they closed', async () => {
    const { rows } = await compileReport(writeOffsReport);
    assert.ok(rows.parameters.includes('written_off') && rows.parameters.includes('collections'));
    assert.ok(rows.sql.includes('"e"."note" in ('));
  });
});
