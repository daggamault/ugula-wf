import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { report } from './report.ts';
import { compileReport } from './report-testing.ts';

const byCode = report({
  dates: null,
  groups: ['code'],
  rows: (db, ctx) =>
    db
      .selectFrom('claim_lines as l')
      .select(['l.code', 'l.total_cents as paid_cents'])
      .where('l.claim_id', '=', ctx.agencyId)
      .as('r'),
  columns: ['code', 'paid_cents'],
  order: 'paid_cents',
  tiebreak: 'code',
  dir: 'desc',
  totals: ['paid_cents']
});

describe('report', () => {
  it('keeps its date kind and groups', () => {
    assert.equal(byCode.dates, null);
    assert.deepEqual(byCode.groups, ['code']);
  });

  it('selects only its columns, never every column', async () => {
    const { rows } = await compileReport(byCode);
    assert.ok(rows.sql.startsWith('select "r"."code" as "code", "r"."paid_cents" as "paid_cents"'));
    assert.ok(!rows.sql.includes('"r".*') && !rows.sql.includes('select *'));
  });

  it('pages 100 rows at a time and returns totals across every page', async () => {
    const { result, rows, totals } = await compileReport(byCode, '', 2);
    assert.ok(rows.sql.includes('count(*) over () as "total"'));
    assert.deepEqual(rows.parameters.slice(-2), [100, 100]);
    assert.ok(totals.sql.startsWith('select coalesce(sum("r"."paid_cents"), 0)::float8'));
    assert.deepEqual(result.totals, { total: '1', paid_cents: 5 });
    assert.equal(result.total, 1);
  });

  it('returns every row in one page when exporting', async () => {
    const { result, rows } = await compileReport(byCode, '', 'all');
    assert.ok(!rows.sql.includes('limit') && !rows.sql.includes('count(*) over ()'));
    assert.ok(rows.sql.endsWith('order by "r"."paid_cents" desc nulls last, "r"."code" desc'));
    assert.deepEqual(result.pageSize, 1);
  });
});
