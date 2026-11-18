import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createReportService, periodOf, totalsOf } from './service.ts';

const today = new Date('2026-11-18T15:00:00Z');

const remittance = (patch: object = {}) => ({
  id: 'r1',
  paid_on: '2026-11-03',
  payer_name: 'MEDICARE',
  trace_number: 'EFT1',
  payment_method: 'ACH',
  total_cents: 6_000,
  claim_paid_cents: 6_500,
  provider_adjustment_cents: 500,
  unmatched_count: 0,
  is_balanced: true,
  reconciled_at: new Date('2026-11-03T13:00:00Z') as Date | null,
  payment_count: 2,
  ...patch
});

describe('periodOf', () => {
  it('runs the last 30 days unless told otherwise', () => {
    assert.deepEqual(periodOf({}, today), {
      from: '2026-10-20',
      to: '2026-11-18',
      payer: undefined
    });
    assert.deepEqual(periodOf({ to: '2026-10-31' }, today), {
      from: '2026-10-02',
      to: '2026-10-31',
      payer: undefined
    });
    assert.deepEqual(periodOf({ from: '2026-11-01', payer: 'blue' }, today), {
      from: '2026-11-01',
      to: '2026-11-18',
      payer: 'blue'
    });
    assert.deepEqual(periodOf({ from: '2026-12-01' }, today), {
      from: '2026-12-01',
      to: '2026-12-01',
      payer: undefined
    });
  });
});

describe('totalsOf', () => {
  it('adds up the deposits and counts what needs a person', () => {
    assert.deepEqual(
      totalsOf([
        remittance(),
        remittance({ id: 'r2', is_balanced: false, unmatched_count: 2, reconciled_at: null })
      ]),
      {
        remittances: 2,
        totalCents: 12_000,
        claimPaidCents: 13_000,
        providerAdjustmentCents: 1_000,
        unbalanced: 1,
        unmatched: 2,
        open: 1
      }
    );
  });
});

describe('the remittance report', () => {
  it('reads the remittances and unmatched payments of the agency in the period', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('"p"."claim_id" is null')
        ? [{ id: 'p9', claim_number: 'NOT-OURS' }]
        : [remittance()]
    );
    const res = await createReportService({ db, now: () => today }).remittances('t-1', {
      from: '2026-11-01',
      to: '2026-11-30'
    });
    assert.ok(res.ok);
    assert.deepEqual(res.value.period, { from: '2026-11-01', to: '2026-11-30', payer: undefined });
    assert.equal(res.value.totals.totalCents, 6_000);
    assert.deepEqual(res.value.unmatched, [{ id: 'p9', claim_number: 'NOT-OURS' }]);
    assert.equal(res.value.truncated, false);
    for (const q of queries) {
      assert.ok(q.parameters.includes('t-1'));
      assert.ok(q.parameters.includes('2026-11-01') && q.parameters.includes('2026-11-30'));
    }
  });

  it('says when the period holds more remittances than it shows', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('"p"."claim_id" is null')
        ? []
        : Array.from({ length: 1001 }, (_, i) => remittance({ id: `r${i}` }))
    );
    const res = await createReportService({ db, now: () => today }).remittances('t-1', {});
    assert.ok(res.ok);
    assert.deepEqual([res.value.remittances.length, res.value.truncated], [1000, true]);
  });
});
