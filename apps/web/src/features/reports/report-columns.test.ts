import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  AgingRow,
  DenialRow,
  HcpcsRow,
  MonthlyRow,
  PayerRow,
  PaymentRow,
  WorkQueueRow,
  WriteOffRow
} from './client.ts';
import {
  adjustmentGroupLabel,
  agingColumns,
  csvRows,
  denialColumns,
  filingLabel,
  formatMonth,
  HCPCS_COLUMNS,
  LEVEL_COLUMNS,
  MONTHLY_COLUMNS,
  PAYMENT_COLUMNS,
  payerColumns,
  totalsOf,
  WRITE_OFF_COLUMNS,
  workQueueColumns
} from './report-columns.ts';

const aging: AgingRow[] = [
  {
    name: 'Medicare',
    in_directory: true,
    claims: 2,
    balance_cents: 150_000,
    days_0_30_cents: 100_000,
    days_31_60_cents: 0,
    days_61_90_cents: 50_000,
    days_91_120_cents: 0,
    days_over_120_cents: 0
  },
  {
    name: null,
    in_directory: true,
    claims: 1,
    balance_cents: 20_000,
    days_0_30_cents: 0,
    days_31_60_cents: 0,
    days_61_90_cents: 0,
    days_91_120_cents: 0,
    days_over_120_cents: 20_000
  }
];

const agingTotals = {
  claims: 3,
  balance_cents: 170_000,
  days_0_30_cents: 100_000,
  days_31_60_cents: 0,
  days_61_90_cents: 50_000,
  days_91_120_cents: 0,
  days_over_120_cents: 20_000
};

const monthly: MonthlyRow = {
  month: '2026-10',
  claims: 3,
  charges_cents: 300_000,
  payer_paid_cents: 120_000,
  patient_paid_cents: 15_000,
  adjusted_cents: 30_000,
  written_off_cents: 0,
  collections_cents: 0,
  open_balance_cents: 135_000,
  billed: 2,
  bill_days: 7
};

describe('report columns', () => {
  it('shows money and counts on screen and plain values in the CSV', () => {
    const columns = agingColumns('payer');
    assert.deepEqual(
      columns.map((c) => c.text(aging[1] as AgingRow, agingTotals)),
      ['Patient', '1', '$0.00', '$0.00', '$0.00', '$0.00', '$200.00', '$200.00']
    );
    assert.deepEqual(csvRows(columns, aging, agingTotals), [
      [
        'Owed By',
        'Claims',
        '0–30 Days',
        '31–60 Days',
        '61–90 Days',
        '91–120 Days',
        'Over 120 Days',
        'Balance'
      ],
      ['Medicare', 2, '1000.00', '0.00', '500.00', '0.00', '0.00', '1500.00'],
      ['Patient', 1, '0.00', '0.00', '0.00', '0.00', '200.00', '200.00']
    ]);
  });

  it('totals from the server totals, which cover every page', () => {
    assert.deepEqual(totalsOf(agingColumns('payer'), agingTotals), [
      'Total',
      '3',
      '$1,000.00',
      '$0.00',
      '$500.00',
      '$0.00',
      '$200.00',
      '$1,700.00'
    ]);
  });

  it('derives rates and averages from sums so totals stay exact', () => {
    const { month: _, ...sums } = monthly;
    const texts = MONTHLY_COLUMNS.map((c) => c.text(monthly, sums));
    assert.equal(texts[9], '50%');
    assert.equal(texts[10], '3.5');
    assert.deepEqual(totalsOf(MONTHLY_COLUMNS, { ...sums, billed: 0 })?.slice(9), ['50%', '—']);
  });

  it('shares each code of the total and leaves columns that do not add up blank', () => {
    const row: HcpcsRow = {
      code: 'A0427',
      description: 'ALS1, emergency transport',
      claims: 2,
      units: 2,
      charges_cents: 190_000
    };
    const totals = { charges_cents: 380_000 };
    assert.deepEqual(
      HCPCS_COLUMNS.map((c) => c.text(row, totals)),
      ['ALS1, emergency transport (A0427)', '2', '2', '$950.00', '$1,900.00', '50%']
    );
    assert.deepEqual(totalsOf(HCPCS_COLUMNS, totals), ['Total', '', '', '', '$3,800.00', '100%']);
  });

  it('lists payments with their paid date, check number and reason codes', () => {
    const row: PaymentRow = {
      id: 'e1',
      posted_at: '2026-10-21T15:00:00Z',
      claim_number: '20261001-0007',
      pcr_number: null,
      first_name: 'Jane',
      last_name: 'Doe',
      service_date: '2026-10-01',
      payer: 'Medicare',
      filing: 'MB',
      kind: 'refunded',
      paid_on: '2026-10-20',
      check_number: 'EFT-9',
      payer_claim_number: 'ICN1',
      paid_cents: -2_500,
      adjusted_cents: 0,
      reason_codes: '',
      posted_by: 'a@b.c',
      note: ''
    };
    const shown = Object.fromEntries(PAYMENT_COLUMNS.map((c) => [c.label, c.text(row, {})]));
    assert.equal(shown['Paid On'], 'Oct 20, 2026');
    assert.equal(shown['Check or EFT'], 'EFT-9');
    assert.equal(shown.Type, 'Refund');
    assert.equal(shown.Paid, '-$25.00');
    assert.equal(shown['Adjustment Reasons'], '—');
    assert.equal(shown.Claim, '20261001-0007');
  });

  it('groups denials by payer or by reason code', () => {
    const row: DenialRow = {
      payer: null,
      code: 'CO-45',
      description: 'Charge exceeds fee schedule.',
      adjustments: 3,
      denials: 1,
      claims: 2,
      amount_cents: 12_000
    };
    assert.deepEqual(
      denialColumns('payer').map((c) => c.text(row, {})),
      [
        'Patient',
        'Charge exceeds fee schedule. (CO-45)',
        'Contractual obligation',
        '3',
        '1',
        '2',
        '$120.00'
      ]
    );
    assert.equal(denialColumns('reason')[0]?.label, 'Reason');
    assert.equal(adjustmentGroupLabel('XX-1'), null);
  });

  it('names payers, financial classes and task queues', () => {
    const payer: PayerRow = {
      name: 'Aetna',
      in_directory: false,
      billed: 1,
      charges_cents: 0,
      paid_cents: 0,
      adjusted_cents: 0,
      responses: 2,
      denials: 1,
      paid_claims: 0,
      pay_days: 0
    };
    assert.equal(payerColumns('payer')[0]?.text(payer, {}), 'Aetna (not in payer directory)');
    assert.equal(payerColumns('payer')[0]?.csv(payer, {}), 'Aetna');
    const rate = payerColumns('payer').find((c) => c.label === 'Denial Rate');
    assert.equal(rate?.text(payer, {}), '50%');
    assert.ok(!payerColumns('payer').some((c) => c.label === 'Paid Nothing'));
    assert.deepEqual(
      ['MB', '', null].map((c) => filingLabel(c)),
      ['Medicare Part B', 'Not in Payer Directory', 'Patient']
    );
    const task: WorkQueueRow = {
      name: 'billing-followup',
      open: 1,
      unassigned: 1,
      days_0_1: 1,
      days_2_7: 0,
      days_8_30: 0,
      days_over_30: 0,
      oldest_at: '2026-10-01T00:00:00Z'
    };
    assert.equal(workQueueColumns('queue')[0]?.text(task, {}), 'Payer Follow-Up');
    assert.equal(workQueueColumns('assignee')[0]?.text({ ...task, name: null }, {}), 'Unassigned');
    assert.ok(!workQueueColumns('assignee').some((c) => c.label === 'Unassigned'));
  });

  it('leaves rates without a base blank on screen and in the CSV', () => {
    const payer: PayerRow = {
      name: null,
      in_directory: true,
      billed: 0,
      charges_cents: 0,
      paid_cents: 0,
      adjusted_cents: 0,
      responses: 3,
      denials: 1,
      paid_claims: 0,
      pay_days: 0
    };
    const columns = payerColumns('payer');
    const at = (label: string) => columns.find((c) => c.label === label);
    assert.equal(at('Paid of Charges')?.text(payer, {}), '—');
    assert.equal(at('Paid of Charges')?.csv(payer, {}), null);
    assert.equal(at('Days to Pay')?.text(payer, {}), '—');
    assert.equal(at('Denial Rate')?.csv(payer, {}), 33.3);
    assert.equal(at('Denial Rate')?.text(payer, {}), '33%');
    assert.equal(columns[0]?.text(payer, {}), 'Patient');
  });

  it('marks only number columns numeric so they line up in tabular figures', () => {
    const columns = agingColumns('payer');
    assert.deepEqual(
      columns.map((c) => c.isNumeric ?? false),
      [false, true, true, true, true, true, true, true]
    );
  });

  it('names levels of service, write-off outcomes and unknown filing codes', () => {
    assert.equal(
      LEVEL_COLUMNS[0]?.text(
        { level: 'ALS1', emergency: false, trips: 1, miles: 4, charges_cents: 0 },
        {}
      ),
      'ALS1 Non-Emergency'
    );
    const closed: WriteOffRow = {
      id: 'w1',
      closed_at: '2026-10-21T15:00:00Z',
      claim_number: '20261001-0009',
      pcr_number: 'P-9',
      first_name: null,
      last_name: 'Doe',
      service_date: null,
      outcome: 'collections',
      charges_cents: 100_000,
      paid_cents: 0,
      adjusted_cents: 0,
      balance_cents: 100_000
    };
    const shown = Object.fromEntries(WRITE_OFF_COLUMNS.map((c) => [c.label, c.text(closed, {})]));
    assert.equal(shown.Outcome, 'Sent to Collections');
    assert.equal(shown.Patient, 'Doe');
    assert.equal(shown.Claim, '20261001-0009');
    assert.equal(shown['Date of Service'], '—');
    assert.equal(shown['Amount Closed'], '$1,000.00');
    assert.equal(filingLabel('ZZ'), 'ZZ');
  });

  it('formats months by name and keeps the ISO month in the CSV', () => {
    assert.equal(formatMonth('2026-10'), 'October 2026');
    assert.equal(formatMonth('2026-01'), 'January 2026');
    assert.equal(MONTHLY_COLUMNS[0]?.csv(monthly, {}), '2026-10');
  });
});
