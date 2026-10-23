import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgingRow, HcpcsRow, MonthlyRow, PayerRow } from './client.ts';
import {
  AgingTable,
  agingCsv,
  formatMonth,
  HcpcsTable,
  hcpcsCsv,
  MonthlyTable,
  monthlyCsv,
  PayerTable,
  payerCsv,
  percentOf
} from './report-tables.tsx';

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

const payers: PayerRow[] = [
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
];

const hcpcs: HcpcsRow[] = [
  { code: 'A0425', claims: 2, units: '19.70', charges_cents: 30_535, average_unit_cents: 1_550 }
];

const html = (element: ReactElement) => renderToStaticMarkup(element);

describe('report tables', () => {
  it('ages balances by who owes them, with the patient named and a total row', () => {
    const out = html(createElement(AgingTable, { rows: aging, all: aging }));
    assert.ok(out.includes('>Medicare<') && out.includes('>Patient<'));
    assert.ok(out.includes('$1,700.00'));
    assert.deepEqual(agingCsv(aging)[2], [
      'Patient',
      1,
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '200.00',
      '200.00'
    ]);
  });

  it('totals every row even when only one page of them is shown, and sorts by column', () => {
    const out = html(
      createElement(AgingTable, {
        rows: aging.slice(0, 1),
        all: aging,
        sorting: {
          sort: 'balance',
          dir: 'desc',
          sortHref: (k) => `/reports/aging?sort=${k}`,
          sortTo: (k, d) => `/reports/aging?sort=${k}&dir=${d}`
        }
      })
    );
    assert.ok(!out.includes('>Patient<'));
    assert.ok(out.includes('$1,700.00'));
    assert.ok(out.includes('aria-sort="descending"'));
    assert.ok(out.includes('href="/reports/aging?sort=owedBy"'));
  });

  it('shows monthly collections with a collection rate', () => {
    const out = html(createElement(MonthlyTable, { rows: monthly, all: monthly }));
    assert.ok(out.includes(formatMonth('2026-10')));
    assert.ok(out.includes('50%'));
    assert.deepEqual(monthlyCsv(monthly)[1]?.slice(0, 3), ['2026-10', 3, '3000.00']);
  });

  it('flags payers missing from the directory and adds patient payments', () => {
    const patient = { paid_cents: 5_000, adjusted_cents: 0 };
    const out = html(createElement(PayerTable, { rows: payers, all: payers, patient }));
    assert.ok(out.includes('Not in payer directory'));
    assert.ok(out.includes('$50.00'));
    assert.deepEqual(payerCsv(payers, patient).at(-1)?.slice(0, 1), ['Patient']);
  });

  it('labels HCPCS codes and totals charges', () => {
    const out = html(createElement(HcpcsTable, { rows: hcpcs, all: hcpcs }));
    assert.ok(out.includes('Ground mileage, per statute mile'));
    assert.ok(out.includes('>19.7<'));
    assert.deepEqual(hcpcsCsv(hcpcs)[1], [
      'A0425',
      'Ground mileage, per statute mile',
      2,
      19.7,
      '15.50',
      '305.35'
    ]);
  });

  it('formats rates and months', () => {
    assert.equal(percentOf(1, 3), '33%');
    assert.equal(percentOf(1, 0), '—');
    assert.match(formatMonth('2026-01'), /2026/);
  });
});
