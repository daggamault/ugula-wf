import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { report } from './report.ts';
import { compileReport, reportContext } from './testing.ts';

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
  it('keeps its date kind and groups, and has no groups or totals unless it declares them', async () => {
    assert.equal(byCode.dates, null);
    assert.deepEqual(byCode.groups, ['code']);
    const plain = report({
      dates: 'service',
      rows: (db) => db.selectFrom('claims as c').select(['c.id']).as('r'),
      columns: ['id'],
      order: 'id',
      tiebreak: 'id',
      dir: 'asc',
      totals: []
    });
    assert.equal(plain.dates, 'service');
    assert.equal(plain.groups, null);
    const { db, queries } = createRecordingDb(() => [{ id: 'c1', total: '1' }]);
    assert.deepEqual(await plain.run(db, reportContext, 1), {
      items: [{ id: 'c1' }],
      total: 1,
      page: 1,
      pageSize: 100,
      totals: {}
    });
    assert.equal(queries.length, 1);
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
    assert.deepEqual(result, {
      items: [{ paid_cents: 5 }],
      total: 1,
      page: 2,
      pageSize: 100,
      totals: { total: '1', paid_cents: 5 }
    });
  });

  it('returns every row in one page when exporting', async () => {
    const { result, rows } = await compileReport(byCode, '', 'all');
    assert.ok(!rows.sql.includes('limit') && !rows.sql.includes('count(*) over ()'));
    assert.ok(rows.sql.endsWith('order by "r"."paid_cents" desc nulls last, "r"."code" desc'));
    assert.deepEqual(result, {
      items: [{ total: '1', paid_cents: 5 }],
      total: 1,
      page: 1,
      pageSize: 1,
      totals: { total: '1', paid_cents: 5 }
    });
  });
});
