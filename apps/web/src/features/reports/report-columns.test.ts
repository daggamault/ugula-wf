import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgingRow, HcpcsRow, MonthlyRow } from './client.ts';
import {
  AGING_COLUMNS,
  csvRows,
  formatMonth,
  HCPCS_COLUMNS,
  MONTHLY_COLUMNS,
  PAYER_COLUMNS,
  payerLines,
  percentOf,
  totalsOf
} from './report-columns.ts';

const aging: AgingRow[] = [
  {
    payer: 'Medicare',
    claims: 2,
    balance_cents: 150_000,
    current_cents: 100_000,
    days_31_60_cents: 0,
    days_61_90_cents: 50_000,
    days_91_120_cents: 0,
    over_120_cents: 0
  },
  {
    payer: null,
    claims: 1,
    balance_cents: 20_000,
    current_cents: 0,
    days_31_60_cents: 0,
    days_61_90_cents: 0,
    days_91_120_cents: 0,
    over_120_cents: 20_000
  }
];

const monthly: MonthlyRow[] = [
  {
    month: '2026-10',
    claims: 3,
    charges_cents: 300_000,
    paid_cents: 150_000,
    adjusted_cents: 30_000,
    open_balance_cents: 120_000,
    unrecovered_cents: 0
  }
];

describe('report columns', () => {
  it('shows money and counts on screen and plain values in the CSV', () => {
    assert.deepEqual(
      AGING_COLUMNS.map((c) => c.text(aging[1] as AgingRow)),
      ['Patient', '1', '$0.00', '$0.00', '$0.00', '$0.00', '$200.00', '$200.00']
    );
    assert.deepEqual(csvRows(AGING_COLUMNS, aging), [
      ['Owed By', 'Claims', '0–30', '31–60', '61–90', '91–120', '120+', 'Balance'],
      ['Medicare', 2, '1000.00', '0.00', '500.00', '0.00', '0.00', '1500.00'],
      ['Patient', 1, '0.00', '0.00', '0.00', '0.00', '200.00', '200.00']
    ]);
  });

  it('totals every row, leaving columns that do not add up blank', () => {
    assert.deepEqual(totalsOf(AGING_COLUMNS, aging), [
      'Total',
      '3',
      '$1,000.00',
      '$0.00',
      '$500.00',
      '$0.00',
      '$200.00',
      '$1,700.00'
    ]);
    assert.deepEqual(totalsOf(MONTHLY_COLUMNS, monthly)?.slice(5, 6), ['50%']);
    const hcpcs: HcpcsRow[] = [
      { code: 'A0427', claims: 2, units: '2', charges_cents: 190_000, average_unit_cents: 95_000 }
    ];
    assert.deepEqual(totalsOf(HCPCS_COLUMNS, hcpcs), ['Total', '', '', '', '', '$1,900.00']);
    assert.equal(HCPCS_COLUMNS[1]?.text(hcpcs[0] as HcpcsRow), 'ALS1, emergency transport');
  });

  it('lists payers with a patient line and flags payers missing from the directory', () => {
    const lines = payerLines(
      [
        {
          payer: 'Aetna',
          in_directory: false,
          claims: 1,
          submitted: 1,
          answered: 0,
          paid_cents: 0,
          adjusted_cents: 0,
          average_days_to_response: null
        }
      ],
      { paid_cents: 5_000, adjusted_cents: 0 }
    );
    assert.deepEqual(
      lines.map((l) => PAYER_COLUMNS[0]?.text(l)),
      ['Aetna (not in payer directory)', 'Patient']
    );
    assert.deepEqual(
      PAYER_COLUMNS.map((c) => c.text(lines[1] as (typeof lines)[number])),
      ['Patient', '—', '—', '—', '$50.00', '$0.00', '—']
    );
  });

  it('formats months and percentages', () => {
    assert.match(formatMonth('2026-10'), /2026/);
    assert.equal(percentOf(1, 4), '25%');
    assert.equal(percentOf(1, 0), '—');
  });
});
