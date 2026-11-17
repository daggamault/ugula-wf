import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDateTime } from '../../shared/format.ts';
import type {
  ActivityRow,
  AgingRow,
  CreditBalanceRow,
  DenialRow,
  HcpcsRow,
  ImportRow,
  MonthlyRow,
  PayerRow,
  PaymentRow,
  ProductivityRow,
  UnbilledRow,
  WorkQueueRow,
  WriteOffRow
} from './client.ts';
import {
  ACTIVITY_COLUMNS,
  adjustmentGroupLabel,
  agingColumns,
  CREDIT_BALANCE_COLUMNS,
  csvRows,
  denialColumns,
  filingLabel,
  formatMonth,
  HCPCS_COLUMNS,
  IMPORT_COLUMNS,
  MONTHLY_COLUMNS,
  PAYMENT_COLUMNS,
  PRODUCTIVITY_COLUMNS,
  payerColumns,
  type ReportColumn,
  totalsOf,
  UNBILLED_COLUMNS,
  WRITE_OFF_COLUMNS,
  workQueueColumns
} from './report-columns.ts';

const shownBy = <R>(columns: readonly ReportColumn<R>[], row: R, totals = {}) =>
  Object.fromEntries(columns.map((c) => [c.label, c.text(row, totals)]));

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

const payment: PaymentRow = {
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

const payer: PayerRow = {
  name: 'Aetna',
  in_directory: false,
  billed: 1,
  charges_cents: 0,
  paid_cents: 0,
  adjusted_cents: 0,
  responses: 2,
  denials: 1,
  rejected: 0,
  paid_claims: 0,
  pay_days: 0
};

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

  it('writes only the header row to the CSV of an empty report', () => {
    assert.deepEqual(csvRows(PRODUCTIVITY_COLUMNS, [], {}), [
      ['Biller', 'Tasks Completed', 'Hours Open per Task', 'Payments Posted']
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

  it('counts missing server totals as zero', () => {
    assert.deepEqual(totalsOf(ACTIVITY_COLUMNS, {}), [
      'Total',
      '0',
      '$0.00',
      '$0.00',
      '$0.00',
      '$0.00',
      '$0.00',
      '$0.00',
      '$0.00'
    ]);
  });

  it('has no totals row when no column adds up', () => {
    const name: ReportColumn<{ name: string }> = {
      label: 'Name',
      text: (r) => r.name,
      csv: (r) => r.name
    };
    assert.equal(totalsOf([name], {}), null);
  });

  it('marks only number columns numeric so they line up in tabular figures', () => {
    assert.deepEqual(
      agingColumns('payer').map((c) => c.isNumeric ?? false),
      [false, true, true, true, true, true, true, true]
    );
  });
});

describe('aging columns', () => {
  it('labels the first column by who owes the balance', () => {
    assert.equal(agingColumns('payer')[0]?.label, 'Owed By');
    assert.equal(agingColumns(null)[0]?.label, 'Owed By');
  });

  it('names the financial class when grouped by class', () => {
    const column = agingColumns('class')[0];
    assert.equal(column?.label, 'Financial Class');
    assert.equal(column?.text({ ...(aging[0] as AgingRow), name: 'MB' }, {}), 'Medicare Part B');
  });

  it('names the claim status when grouped by status', () => {
    const column = agingColumns('status')[0];
    assert.equal(column?.label, 'Status');
    assert.equal(column?.text({ ...(aging[0] as AgingRow), name: 'follow_up' }, {}), 'Follow Up');
  });
});

describe('unbilled columns', () => {
  const row: UnbilledRow = {
    claim_number: '20261001-0001',
    pcr_number: 'P-1',
    first_name: 'Jane',
    last_name: 'Doe',
    service_date: '2026-10-01',
    status: 'needs_review',
    queue: 'billing-followup',
    age_days: 12,
    file_by: '2027-10-01',
    charges_cents: 95_000
  };

  it('shows the claim, its status and the task it waits on', () => {
    assert.deepEqual(shownBy(UNBILLED_COLUMNS, row), {
      Claim: '20261001-0001',
      PCR: 'P-1',
      Patient: 'Doe, Jane',
      'Date of Service': 'Oct 1, 2026',
      Status: 'Needs Review',
      'Waiting On': 'Payer Follow-Up',
      'Days Old': '12',
      'File By': 'Oct 1, 2027',
      Charges: '$950.00'
    });
  });

  it('leaves the task, missing PCR and unknown filing limit blank', () => {
    const shown = shownBy(UNBILLED_COLUMNS, {
      ...row,
      queue: null,
      pcr_number: null,
      file_by: null
    });
    assert.equal(shown['Waiting On'], '—');
    assert.equal(shown['File By'], '—');
    assert.equal(shown.PCR, '—');
    assert.equal(UNBILLED_COLUMNS[1]?.csv({ ...row, pcr_number: null }, {}), null);
  });

  it('does not total the days old', () => {
    assert.deepEqual(totalsOf(UNBILLED_COLUMNS, { age_days: 30, charges_cents: 95_000 }), [
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '$950.00'
    ]);
  });
});

describe('monthly columns', () => {
  it('derives rates and averages from sums so totals stay exact', () => {
    const { month: _, ...sums } = monthly;
    const texts = MONTHLY_COLUMNS.map((c) => c.text(monthly, sums));
    assert.equal(texts[9], '50%');
    assert.equal(texts[10], '3.5');
    assert.deepEqual(totalsOf(MONTHLY_COLUMNS, { ...sums, billed: 0 })?.slice(9), ['50%', '—']);
  });

  it('rounds rates to one decimal in the CSV', () => {
    const third = { ...monthly, payer_paid_cents: 90_000, patient_paid_cents: 0 };
    assert.equal(MONTHLY_COLUMNS[9]?.csv(third, {}), 33.3);
    assert.equal(MONTHLY_COLUMNS[9]?.text(third, {}), '33%');
  });

  it('leaves rates and averages without a base blank', () => {
    const unbilled = { ...monthly, billed: 0, charges_cents: 0, adjusted_cents: 0 };
    assert.equal(MONTHLY_COLUMNS[9]?.csv(unbilled, {}), null);
    assert.equal(MONTHLY_COLUMNS[9]?.text(unbilled, {}), '—');
    assert.equal(MONTHLY_COLUMNS[10]?.csv(unbilled, {}), null);
    assert.equal(MONTHLY_COLUMNS[10]?.text(unbilled, {}), '—');
  });

  it('formats months by name and keeps the ISO month in the CSV', () => {
    assert.equal(formatMonth('2026-10'), 'October 2026');
    assert.equal(formatMonth('2026-01'), 'January 2026');
    assert.equal(MONTHLY_COLUMNS[0]?.text(monthly, {}), 'October 2026');
    assert.equal(MONTHLY_COLUMNS[0]?.csv(monthly, {}), '2026-10');
  });
});

describe('activity columns', () => {
  it('shows what was booked in the month', () => {
    const row: ActivityRow = {
      month: '2026-09',
      claims_billed: 1_200,
      charges_billed_cents: 100,
      payer_paid_cents: 200,
      patient_paid_cents: 300,
      adjusted_cents: 400,
      refunds_cents: 450,
      written_off_cents: 500,
      collections_cents: 600
    };
    assert.deepEqual(
      ACTIVITY_COLUMNS.map((c) => c.text(row, {})),
      ['September 2026', '1,200', '$1.00', '$2.00', '$3.00', '$4.00', '$4.50', '$5.00', '$6.00']
    );
  });
});

describe('payment columns', () => {
  it('lists payments with their paid date, check number and reason codes', () => {
    assert.deepEqual(shownBy(PAYMENT_COLUMNS, payment), {
      Posted: formatDateTime('2026-10-21T15:00:00Z'),
      'Paid On': 'Oct 20, 2026',
      Claim: '20261001-0007',
      Patient: 'Doe, Jane',
      'Date of Service': 'Oct 1, 2026',
      'Paid By': 'Medicare',
      'Financial Class': 'Medicare Part B',
      Type: 'Refund',
      'Check or EFT': 'EFT-9',
      'Payer Claim Number': 'ICN1',
      Paid: '-$25.00',
      Adjusted: '$0.00',
      'Adjustment Reasons': '—',
      'Posted By': 'a@b.c',
      Note: '—'
    });
  });

  it('shows patient payments without a financial class', () => {
    const shown = shownBy(PAYMENT_COLUMNS, {
      ...payment,
      payer: null,
      kind: 'response',
      paid_on: null,
      reason_codes: 'CO-45',
      note: 'Card'
    });
    assert.equal(shown['Paid By'], 'Patient');
    assert.equal(shown['Financial Class'], '—');
    assert.equal(shown.Type, 'Payment');
    assert.equal(shown['Paid On'], '—');
    assert.equal(shown['Adjustment Reasons'], 'CO-45');
    assert.equal(shown.Note, 'Card');
  });

  it('marks payers outside the directory', () => {
    assert.equal(
      shownBy(PAYMENT_COLUMNS, { ...payment, filing: null })['Financial Class'],
      'Not in Payer Directory'
    );
  });
});

describe('denial columns', () => {
  const row: DenialRow = {
    payer: null,
    code: 'CO-45',
    description: 'Charge exceeds fee schedule.',
    denials: 1,
    claims: 2,
    amount_cents: 12_000
  };

  it('groups denials by payer', () => {
    assert.deepEqual(
      denialColumns('payer').map((c) => c.text(row, {})),
      ['Patient', 'Charge exceeds fee schedule.', 'Contractual obligation', '1', '2', '$120.00']
    );
  });

  it('groups denials by reason code without a payer column', () => {
    assert.deepEqual(
      denialColumns('reason').map((c) => c.text({ ...row, description: null }, {})),
      ['CO-45', 'Contractual obligation', '1', '2', '$120.00']
    );
  });

  it('names only known adjustment groups', () => {
    assert.equal(adjustmentGroupLabel('CO-45'), 'Contractual obligation');
    assert.equal(adjustmentGroupLabel('XX-1'), null);
    assert.equal(denialColumns('reason')[1]?.text({ ...row, code: 'XX-1' }, {}), '—');
  });

  it('shows denials that came without a reason code', () => {
    const columns = denialColumns('reason');
    assert.equal(columns[0]?.text({ ...row, code: null }, {}), 'No Reason Given');
    assert.equal(columns[1]?.text({ ...row, code: null }, {}), '—');
  });
});

describe('write-off columns', () => {
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

  it('shows how each claim was closed and what was left on it', () => {
    assert.deepEqual(shownBy(WRITE_OFF_COLUMNS, closed), {
      Closed: formatDateTime('2026-10-21T15:00:00Z'),
      Claim: '20261001-0009',
      PCR: 'P-9',
      Patient: 'Doe',
      'Date of Service': '—',
      Outcome: 'Sent to Collections',
      Charges: '$1,000.00',
      Paid: '$0.00',
      Adjusted: '$0.00',
      'Amount Closed': '$1,000.00'
    });
  });

  it('names write-offs and title-cases unknown outcomes', () => {
    const outcome = (o: string) => shownBy(WRITE_OFF_COLUMNS, { ...closed, outcome: o }).Outcome;
    assert.equal(outcome('written_off'), 'Written Off');
    assert.equal(outcome('bad_debt'), 'Bad Debt');
  });
});

describe('credit balance columns', () => {
  const row: CreditBalanceRow = {
    claim_number: '20261001-0011',
    pcr_number: 'P-11',
    first_name: 'Jane',
    last_name: 'Doe',
    service_date: '2026-10-01',
    status: 'paid',
    charges_cents: 100_000,
    paid_cents: 120_000,
    adjusted_cents: 0,
    credit_cents: 20_000,
    last_paid_at: '2026-10-21T15:00:00Z',
    age_days: 9
  };

  it('shows what was overpaid and how long ago', () => {
    assert.deepEqual(shownBy(CREDIT_BALANCE_COLUMNS, row), {
      Claim: '20261001-0011',
      PCR: 'P-11',
      Patient: 'Doe, Jane',
      'Date of Service': 'Oct 1, 2026',
      Status: 'Paid',
      Charges: '$1,000.00',
      Paid: '$1,200.00',
      Adjusted: '$0.00',
      Credit: '$200.00',
      'Last Paid': formatDateTime('2026-10-21T15:00:00Z'),
      'Days Since Paid': '9'
    });
    assert.equal(CREDIT_BALANCE_COLUMNS.at(-1)?.csv(row, {}), 9);
  });

  it('totals only the credit', () => {
    assert.deepEqual(totalsOf(CREDIT_BALANCE_COLUMNS, { credit_cents: 20_000 }), [
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '$200.00',
      '',
      ''
    ]);
  });

  it('leaves the age blank without a payment', () => {
    const shown = shownBy(CREDIT_BALANCE_COLUMNS, { ...row, last_paid_at: null, age_days: null });
    assert.equal(shown['Last Paid'], '—');
    assert.equal(shown['Days Since Paid'], '—');
  });
});

describe('payer columns', () => {
  it('marks payers outside the directory on screen but not in the CSV', () => {
    assert.equal(payerColumns('payer')[0]?.text(payer, {}), 'Aetna (not in payer directory)');
    assert.equal(payerColumns('payer')[0]?.csv(payer, {}), 'Aetna');
    assert.equal(payerColumns('payer')[0]?.text({ ...payer, in_directory: true }, {}), 'Aetna');
  });

  it('names the financial class when grouped by class', () => {
    const column = payerColumns('class')[0];
    assert.equal(column?.label, 'Financial Class');
    assert.equal(column?.text({ ...payer, name: 'MB' }, {}), 'Medicare Part B');
    assert.equal(column?.csv({ ...payer, name: null }, {}), 'Patient');
  });

  it('leaves rates without a base blank on screen and in the CSV', () => {
    const row = { ...payer, name: null, in_directory: true, responses: 3 };
    const columns = payerColumns('payer');
    const at = (label: string) => columns.find((c) => c.label === label);
    assert.equal(columns[0]?.text(row, {}), 'Patient');
    assert.equal(columns[0]?.csv(row, {}), 'Patient');
    assert.equal(at('Paid of Charges')?.text(row, {}), '—');
    assert.equal(at('Paid of Charges')?.csv(row, {}), null);
    assert.equal(at('Days to Pay')?.text(row, {}), '—');
    assert.equal(at('Denial Rate')?.csv(row, {}), 33.3);
    assert.equal(at('Denial Rate')?.text(row, {}), '33%');
  });

  it('averages days to pay over the claims that were paid', () => {
    const shown = shownBy(payerColumns('payer'), {
      ...payer,
      charges_cents: 200_000,
      paid_cents: 150_000,
      paid_claims: 4,
      pay_days: 50
    });
    assert.equal(shown['Paid of Charges'], '75%');
    assert.equal(shown['Days to Pay'], '12.5');
    assert.equal(shown['Denial Rate'], '50%');
  });

  it('rates rejections over the claims billed', () => {
    const shown = shownBy(payerColumns('payer'), { ...payer, billed: 4, rejected: 1 });
    assert.equal(shown.Rejected, '1');
    assert.equal(shown['Rejection Rate'], '25%');
  });
});

describe('filingLabel', () => {
  it('names filing codes, the patient and payers outside the directory', () => {
    assert.deepEqual(
      ['MB', '', null, 'ZZ'].map((c) => filingLabel(c)),
      ['Medicare Part B', 'Not in Payer Directory', 'Patient', 'ZZ']
    );
  });

  it('does not read inherited object keys as filing codes', () => {
    assert.equal(filingLabel('toString'), 'toString');
  });
});

describe('HCPCS columns', () => {
  const row: HcpcsRow = {
    code: 'A0427',
    description: 'ALS1, emergency transport',
    claims: 2,
    units: 2,
    charges_cents: 190_000
  };

  it('shares each code of the total and leaves columns that do not add up blank', () => {
    const totals = { charges_cents: 380_000 };
    assert.deepEqual(
      HCPCS_COLUMNS.map((c) => c.text(row, totals)),
      ['ALS1, emergency transport', '2', '2', '$950.00', '$1,900.00', '50%']
    );
    assert.deepEqual(totalsOf(HCPCS_COLUMNS, totals), ['Total', '', '', '', '$3,800.00', '100%']);
  });

  it('shows the code under the description on screen and both in the CSV', () => {
    assert.equal(HCPCS_COLUMNS[0]?.code?.(row), 'A0427');
    assert.equal(HCPCS_COLUMNS[0]?.csv(row, {}), 'ALS1, emergency transport (A0427)');
  });

  it('rounds fractional units and average prices', () => {
    const miles = { ...row, code: 'A0425', description: null, units: 12.25, charges_cents: 10_000 };
    assert.deepEqual(
      HCPCS_COLUMNS.map((c) => c.csv(miles, { charges_cents: 0 })),
      ['A0425', 2, 12.3, '8.16', '100.00', null]
    );
    assert.equal(HCPCS_COLUMNS[3]?.text(miles, {}), '$8.16');
  });
});

describe('work queue columns', () => {
  it('names task queues and counts the unassigned', () => {
    const columns = workQueueColumns('queue');
    assert.deepEqual(
      columns.map((c) => c.label),
      [
        'Task Type',
        'Open',
        'Unassigned',
        '0–1 Days',
        '2–7 Days',
        '8–30 Days',
        'Over 30 Days',
        'Oldest'
      ]
    );
    assert.equal(columns[0]?.text(task, {}), 'Payer Follow-Up');
    assert.equal(columns[0]?.text({ ...task, name: null }, {}), '—');
    assert.equal(columns[7]?.text(task, {}), formatDateTime('2026-10-01T00:00:00Z'));
  });

  it('names assignees without an unassigned count', () => {
    const columns = workQueueColumns('assignee');
    assert.equal(columns[0]?.label, 'Assignee');
    assert.equal(columns[0]?.text({ ...task, name: 'a@b.c' }, {}), 'a@b.c');
    assert.equal(columns[0]?.text({ ...task, name: null }, {}), 'Unassigned');
    assert.equal(
      columns.some((c) => c.label === 'Unassigned'),
      false
    );
  });
});

describe('productivity columns', () => {
  it('averages hours per task', () => {
    const row: ProductivityRow = {
      name: 'a@b.c',
      tasks: 3,
      task_hours: 1,
      posted: 5
    };
    assert.deepEqual(
      PRODUCTIVITY_COLUMNS.map((c) => c.text(row, {})),
      ['a@b.c', '3', '0.3', '5']
    );
    assert.equal(PRODUCTIVITY_COLUMNS[2]?.csv(row, {}), 0.3);
  });
});

describe('import columns', () => {
  it('shows what each file became', () => {
    const row: ImportRow = {
      id: 'i1',
      received_at: '2026-10-21T15:00:00Z',
      file_name: 'pcrs.xml',
      source: 'nemsis_xml',
      pcrs: 10,
      billed: 5,
      drafts: 1,
      voided: 1,
      revisions: 1,
      no_claim: 1,
      failed: 1,
      charges_cents: 500_000
    };
    assert.deepEqual(
      IMPORT_COLUMNS.map((c) => c.text(row, {})),
      [
        formatDateTime('2026-10-21T15:00:00Z'),
        'pcrs.xml',
        'NEMSIS XML',
        '10',
        '5',
        '1',
        '1',
        '1',
        '1',
        '1',
        '$5,000.00'
      ]
    );
  });
});
