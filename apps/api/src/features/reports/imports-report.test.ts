import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importsReport } from './imports-report.ts';
import { compileReport } from './report-testing.ts';

describe('importsReport', () => {
  it('counts revisions apart from PCRs that never got a claim', async () => {
    const { rows } = await compileReport(importsReport);
    assert.ok(rows.sql.includes('c.id is null and exists'));
    assert.ok(rows.sql.includes('c.id is null and not exists'));
    assert.ok(rows.sql.includes('o.agency_id = i.agency_id and o.pcr_number = ir.pcr_number'));
    assert.ok(rows.sql.includes('"ch"."parent_id" = "i"."run_id"'));
  });
});
