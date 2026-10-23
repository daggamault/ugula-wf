import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findReport, REPORTS } from './catalog.tsx';

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
      findReport('monthly')?.csv({ rows: [] }, range).name,
      'monthly-2026-01-01-to-2026-03-31.csv'
    );
    assert.equal(
      findReport('aging')?.csv({ asOf: '2026-10-23', rows: [] }, range).name,
      'ar-aging-2026-10-23.csv'
    );
    assert.equal(
      findReport('payers')?.isEmpty({ rows: [], patient: { paid_cents: 5, adjusted_cents: 0 } }),
      false
    );
    assert.equal(findReport('nope'), undefined);
  });
});
