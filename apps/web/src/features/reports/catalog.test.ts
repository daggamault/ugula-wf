import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findReport, REPORTS } from './catalog.ts';

const range = { from: '2026-01-01', to: '2026-03-31' };

describe('report catalog', () => {
  it('describes each report once, with the client call and file it produces', async () => {
    assert.deepEqual(
      REPORTS.map((r) => [r.id, r.usesPeriod]),
      [
        ['aging', false],
        ['monthly', true],
        ['payers', true],
        ['hcpcs', true]
      ]
    );
    const calls: string[] = [];
    const client = {
      aging: async () => calls.push('aging'),
      monthly: async (r: unknown) => calls.push(`monthly ${JSON.stringify(r)}`),
      payers: async () => calls.push('payers'),
      hcpcs: async () => calls.push('hcpcs')
    } as never;
    for (const r of REPORTS) await r.load(client, range);
    assert.deepEqual(calls, ['aging', `monthly ${JSON.stringify(range)}`, 'payers', 'hcpcs']);
    assert.equal(
      findReport('monthly')?.fileName({ rows: [] }, range),
      'monthly-2026-01-01-to-2026-03-31.csv'
    );
    assert.equal(
      findReport('aging')?.fileName({ asOf: '2026-10-23', rows: [] }, range),
      'ar-aging-2026-10-23.csv'
    );
    assert.equal(findReport('nope'), undefined);
  });

  it('adds the patient line to payer performance only when there is something to show', () => {
    const payers = findReport('payers');
    const none = { rows: [], patient: { paid_cents: 0, adjusted_cents: 0 } };
    assert.equal(payers?.rowsOf(none).length, 0);
    assert.equal(
      payers?.rowsOf({ ...none, patient: { paid_cents: 5, adjusted_cents: 0 } }).length,
      1
    );
  });
});
