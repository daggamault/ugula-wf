import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimIssue } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Page } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import {
  addEntry,
  amountOf,
  ClaimFiles,
  type ClaimTab,
  ClaimView,
  describeCycle,
  describeProgress,
  EventsTable,
  entryOf,
  lockedReason,
  moveItem,
  payersErrorOf,
  paymentDetailsOf,
  type ResponseDraft,
  removeEntry,
  toPayerInput,
  toResponse
} from './claim-page.tsx';
import type { ClaimDetail, ClaimEvent, ClaimProgress } from './client.ts';

const claim: ClaimDetail = {
  id: 'c1',
  number: 12,
  patient_number: 3,
  import_report_id: 'r1',
  import_id: 'i1',
  import_file_name: 'october.xml',
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 114_220,
  service_date: '2026-10-01',
  payers: ['Medicare', 'Blue Plan'],
  status: 'submitted',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe',
  trip_type: 'emergency',
  emergency: true,
  loaded_miles: '12.4',
  lines: [{ position: 1, code: 'A0427', units: 1, unit_cents: 95_000, total_cents: 95_000 }],
  birth_date: '1958-04-12',
  patient_id: 'p1',
  cycle_run_id: 'cycle-1',
  cycle_status: 'suspended',
  coverages: [
    {
      id: 'cov-m',
      position: 1,
      payer: 'Medicare',
      payer_id: 'p-m',
      payer_code: null,
      member_id: '1EG4',
      group_id: null,
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null,
      eligibility: null,
      eligibility_note: null,
      eligibility_checked_at: null
    },
    {
      id: 'cov-b',
      position: 2,
      payer: 'Blue Plan',
      payer_id: null,
      payer_code: null,
      member_id: null,
      group_id: null,
      relationship: '01',
      insured_first_name: 'John',
      insured_last_name: 'Doe',
      eligibility: null,
      eligibility_note: null,
      eligibility_checked_at: null
    }
  ],
  diagnoses: ['R079', 'I10'],
  origin_code: null,
  destination_code: null,
  pickup_address_line: '9 Elm St',
  pickup_city: null,
  pickup_state: 'IL',
  pickup_postal_code: '62704',
  destination_name: 'St. Mary',
  destination_address_line: null,
  destination_city: null,
  destination_state: null,
  destination_postal_code: null,
  gender: 'F',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62704',
  signature: 'signed',
  signature_note: null,
  pcs_on_file: null,
  pcs_signed_on: null,
  transport_reason: 'A',
  condition_codes: ['09'],
  prior_authorization: null,
  weight_kg: '81.6',
  at_scene_at: '2026-10-01T10:05:00Z',
  left_scene_at: '2026-10-01T10:25:00Z',
  at_destination_at: '2026-10-01T10:40:00Z',
  tasks: [],
  task_id: null,
  task_title: null,
  task_queue: null,
  task_kind: null,
  task_assignee_email: null,
  open_tasks: 0
};

const medicare = { id: 'cov-m', payer: 'Medicare' };

const loaded = (items: ClaimEvent[]): Resource<Page<ClaimEvent>> => ({
  data: { items, total: items.length, page: 1, pageSize: 25 },
  error: undefined,
  loading: false,
  reload: () => undefined
});

const render = (
  over: Partial<ClaimDetail> = {},
  progress: ClaimProgress | null = null,
  tab: ClaimTab = 'overview',
  issues: readonly ClaimIssue[] = []
) =>
  renderToStaticMarkup(
    createElement(ClaimView, {
      claim: { ...claim, ...over },
      issues,
      tab,
      files: [],
      history: loaded([
        {
          id: 'e1',
          kind: 'response',
          coverage_id: null,
          payer: null,
          paid_cents: 5_000,
          adjusted_cents: 0,
          paid_on: '2026-10-01',
          check_number: 'CHK-77',
          payer_claim_number: null,
          note: 'card',
          created_at: '2026-10-02T00:00:00Z',
          has_document: false
        },
        {
          id: 'e2',
          kind: 'statement',
          coverage_id: null,
          payer: null,
          paid_cents: 0,
          adjusted_cents: 0,
          paid_on: null,
          check_number: null,
          payer_claim_number: null,
          note: 'Patient statement 1 of 3',
          created_at: '2026-10-03T00:00:00Z',
          has_document: true
        }
      ]),
      progress,
      onSavePayers: async () => undefined,
      onRecord: async () => true,
      onRestart: async () => undefined,
      onSaveData: async () => true,
      onCheckEligibility: async () => undefined,
      onDownloadEligibility: async () => undefined,
      documentUrl: (eventId: string) => `/docs/${eventId}`
    })
  );

describe('paymentDetailsOf', () => {
  it('lists the paid date, check number and payer claim number a payment came with', () => {
    assert.equal(
      paymentDetailsOf({
        paid_on: '2026-10-20',
        check_number: 'EFT-9',
        payer_claim_number: 'ICN1'
      }),
      'Paid Oct 20, 2026 · Check or EFT EFT-9 · Payer claim ICN1'
    );
    assert.equal(
      paymentDetailsOf({ paid_on: null, check_number: null, payer_claim_number: null }),
      ''
    );
  });
});

describe('amountOf', () => {
  it('describes paid and adjusted amounts together, and refunds as paid back', () => {
    assert.equal(
      amountOf({ kind: 'response', paid_cents: 40_000, adjusted_cents: 10_000 }),
      '$400.00 paid · $100.00 adjusted'
    );
    assert.equal(amountOf({ kind: 'response', paid_cents: 0, adjusted_cents: 0 }), '');
    assert.equal(
      amountOf({ kind: 'refunded', paid_cents: -2_500, adjusted_cents: 0 }),
      '$25.00 refunded'
    );
  });
});

describe('describeProgress', () => {
  it('tells billers what the claim cycle is doing', () => {
    assert.match(
      describeProgress({ step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 }),
      /^Waiting on Medicare/
    );
    assert.match(
      describeProgress({ step: 'followUp', coverage: medicare, balanceCents: 1 }),
      /follow-up task is waiting/
    );
    assert.match(
      describeProgress({ step: 'review', coverage: medicare, balanceCents: 1 }),
      /^Needs review before it goes to Medicare/
    );
    assert.match(
      describeProgress({ step: 'reconcile', coverage: medicare, balanceCents: 1 }),
      /reconcile task is waiting/
    );
    assert.equal(
      describeProgress({ step: 'statement', statement: 2, balanceCents: 1 }),
      'Sending patient statement 2 of 3.'
    );
    assert.match(
      describeProgress({ step: 'submit', coverage: medicare, balanceCents: 1 }),
      /^Approved. Creating its 837P file for Medicare/
    );
    assert.match(
      describeProgress({ step: 'confirmPayers', balanceCents: 1 }),
      /No payer is on this claim/
    );
    assert.match(
      describeProgress({ step: 'reviewPatient', balanceCents: 1 }),
      /before the patient is billed/
    );
    assert.match(
      describeProgress({ step: 'overpaid', balanceCents: -2_500 }),
      /^\$25\.00 more has been paid/
    );
    assert.match(
      describeProgress({ step: 'awaitPatient', waitMs: 1, balanceCents: 1 }),
      /^Waiting on the patient/
    );
    assert.match(
      describeProgress({ step: 'collections', balanceCents: 1 }),
      /balance review task is waiting/
    );
    assert.equal(describeProgress({ step: 'closed', balanceCents: 0 }), 'Paid in full. Closing.');
  });
});

describe('describeCycle', () => {
  const waiting = { step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 } as const;
  it('reports a stopped, stuck or missing cycle instead of the expected next step', () => {
    assert.equal(
      describeCycle({ status: 'submitted', cycle_status: 'suspended' }, waiting)?.intent,
      'info'
    );
    const failed = describeCycle({ status: 'submitted', cycle_status: 'failed' }, waiting);
    assert.equal(failed?.intent, 'danger');
    assert.match(failed?.text ?? '', /payer cycle failed/);
    assert.match(
      describeCycle({ status: 'submitted', cycle_status: 'cancelled' }, waiting)?.text ?? '',
      /was cancelled/
    );
    assert.match(
      describeCycle({ status: 'submitted', cycle_status: 'faulted' }, waiting)?.text ?? '',
      /stuck run task/
    );
    const missing = describeCycle({ status: 'ready', cycle_status: null }, null);
    assert.deepEqual(
      [missing?.intent, missing?.stopped, missing?.restartable],
      ['warning', true, true]
    );
    assert.equal(
      describeCycle({ status: 'submitted', cycle_status: 'faulted' }, waiting)?.restartable,
      false
    );
    assert.equal(describeCycle({ status: 'submitted', cycle_status: 'running' }, null), null);
    assert.equal(
      describeCycle(
        { status: 'submitted', cycle_status: 'running' },
        { step: 'overpaid', balanceCents: -1 }
      )?.intent,
      'warning'
    );
    assert.equal(describeCycle({ status: 'paid', cycle_status: 'completed' }, null), null);
    const filing = describeCycle(
      { status: 'ready', cycle_status: 'running' },
      { step: 'submit', coverage: medicare, balanceCents: 1 }
    );
    assert.equal(filing?.intent, 'info');
    const draft = describeCycle({ status: 'draft', cycle_status: null }, null);
    assert.deepEqual([draft?.intent, draft?.restartable], ['info', false]);
  });
});

describe('lockedReason', () => {
  it('locks drafts and closed claims with a reason', () => {
    assert.equal(lockedReason('submitted'), undefined);
    assert.match(lockedReason('draft') ?? '', /still a draft/);
    assert.equal(lockedReason('void'), 'This claim is closed.');
  });
});

describe('moveItem', () => {
  it('reorders within bounds and leaves the list alone otherwise', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
    assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b']);
    assert.deepEqual(moveItem(['a', 'b'], 1, 2), ['a', 'b']);
  });
});

const entry = (id: string, name: string) => ({
  id,
  name,
  relationship: '18' as const,
  insuredFirstName: null,
  insuredLastName: null
});

describe('addEntry and removeEntry', () => {
  it('adds a payer once by name and removes only the chosen row', () => {
    const list = [entry('1', 'Medicare'), entry('2', 'Medicare')];
    assert.deepEqual(addEntry(list, ' medicare ', '3'), list);
    assert.deepEqual(addEntry(list, '  ', '3'), list);
    assert.deepEqual(addEntry(list, ' Aetna ', '3').at(-1), entry('3', 'Aetna'));
    assert.deepEqual(removeEntry(list, '2'), [entry('1', 'Medicare')]);
  });
});

describe('payer relationships', () => {
  it('reads coverage relationships and drops insured names for self', () => {
    assert.deepEqual(
      entryOf({
        id: 'c',
        position: 0,
        payer: 'A',
        payer_id: null,
        payer_code: null,
        member_id: null,
        group_id: null,
        relationship: '18',
        insured_first_name: null,
        insured_last_name: null,
        eligibility: null,
        eligibility_note: null,
        eligibility_checked_at: null
      }),
      entry('c', 'A')
    );
    assert.deepEqual(
      toPayerInput({ ...entry('c', 'A'), insuredFirstName: 'Sam', insuredLastName: 'Doe' }),
      { name: 'A', relationship: '18', insuredFirstName: null, insuredLastName: null }
    );
    assert.deepEqual(
      toPayerInput({
        ...entry('c', 'A'),
        relationship: '01',
        insuredFirstName: ' Sam ',
        insuredLastName: ''
      }),
      { name: 'A', relationship: '01', insuredFirstName: 'Sam', insuredLastName: null }
    );
  });

  it('needs the insured name whenever the patient is not the insured', () => {
    assert.equal(payersErrorOf([entry('1', 'A')]), undefined);
    assert.match(
      payersErrorOf([
        { ...entry('1', 'Blue Plan'), relationship: '19', insuredFirstName: 'Sam' }
      ]) ?? '',
      /first and last name for Blue Plan/
    );
    assert.equal(
      payersErrorOf([
        { ...entry('1', 'A'), relationship: '01', insuredFirstName: 'Sam', insuredLastName: 'Doe' }
      ]),
      undefined
    );
  });
});

const draft = (patch: Partial<ResponseDraft> = {}): ResponseDraft => ({
  kind: 'response',
  coverageId: 'cov-m',
  paid: '',
  adjusted: '',
  paidOn: '',
  checkNumber: '',
  payerClaimNumber: '',
  adjustments: [],
  note: '',
  ...patch
});

describe('toResponse', () => {
  it('converts dollars to cents and treats a blank payer as the patient', () => {
    assert.deepEqual(
      toResponse(
        draft({
          paid: '600',
          adjusted: '100.5',
          paidOn: '2026-10-20',
          checkNumber: ' EFT-9 ',
          payerClaimNumber: 'ICN1',
          adjustments: [
            { id: 'a', group: 'CO', reason: ' 45 ', amount: '100.50' },
            { id: 'b', group: 'CR', reason: 'b7', amount: '-5' }
          ],
          note: ' ok '
        })
      ),
      {
        kind: 'response',
        coverageId: 'cov-m',
        paidCents: 60_000,
        adjustedCents: 10_050,
        paidOn: '2026-10-20',
        checkNumber: 'EFT-9',
        payerClaimNumber: 'ICN1',
        adjustments: [
          { group: 'CO', reason: '45', cents: 10_050 },
          { group: 'CR', reason: 'B7', cents: -500 }
        ],
        note: 'ok'
      }
    );
    assert.equal(toResponse(draft({ coverageId: '' })), 'A patient payment needs an amount');
    assert.equal(toResponse(draft({ paid: '-1' })), 'Enter amounts of zero or more');
    assert.equal(toResponse(draft({ adjusted: 'x' })), 'Enter amounts of zero or more');
    const patient = toResponse(draft({ coverageId: '', paid: '20', payerClaimNumber: 'ICN1' }));
    assert.deepEqual(
      typeof patient === 'string'
        ? patient
        : [patient.coverageId, patient.paidCents, patient.payerClaimNumber],
      [null, 2_000, null]
    );
    const zero = toResponse(draft());
    assert.deepEqual(
      typeof zero === 'string'
        ? zero
        : [zero.paidCents, zero.adjustedCents, zero.paidOn, zero.checkNumber],
      [0, 0, null, null]
    );
    assert.match(
      String(
        toResponse(draft({ adjustments: [{ id: 'a', group: 'CO', reason: '45', amount: '0' }] }))
      ),
      /Each reason code/
    );
    assert.match(
      String(
        toResponse(draft({ adjustments: [{ id: 'a', group: 'CO', reason: '', amount: '1' }] }))
      ),
      /Each reason code/
    );
  });

  it('records refunds without adjustments or a payer claim number', () => {
    const refund = toResponse(
      draft({
        kind: 'refunded',
        paid: '25',
        adjusted: '9',
        payerClaimNumber: 'ICN1',
        adjustments: [{ id: 'a', group: 'CO', reason: '45', amount: '1' }]
      })
    );
    assert.deepEqual(
      typeof refund === 'string'
        ? refund
        : [refund.paidCents, refund.adjustedCents, refund.adjustments, refund.payerClaimNumber],
      [2_500, 0, [], null]
    );
    assert.equal(toResponse(draft({ kind: 'refunded' })), 'A refund needs the amount paid back');
  });
});

describe('ClaimView', () => {
  it('shows the trip type and the claim check issues of an open claim', () => {
    const issues: ClaimIssue[] = [
      { level: 'blocking', field: 'memberId', message: 'Member ID missing', coverageId: 'cov-b' }
    ];
    const html = render({}, null, 'overview', issues);
    assert.ok(html.includes('Emergency transport'));
    assert.ok(
      html.includes('Must Be Fixed') && html.includes('Member ID: </span>Member ID missing')
    );
    assert.ok(!render({ status: 'paid' }, null, 'overview', issues).includes('Must Be Fixed'));
  });

  it('posts payments with paid date, check number and reason codes', () => {
    const html = render({}, { step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 });
    assert.ok(html.includes('Paid On') && html.includes('Check or EFT Number'));
    assert.ok(html.includes('Payer Claim Number') && html.includes('Add Reason Code'));
    assert.ok(html.includes('>Refund<'));
    assert.ok(render({}, null, 'history').includes('Check or EFT CHK-77'));
  });

  it('shows lines, ordered payers, history and the response form for open claims', () => {
    const html = render(
      {},
      {
        step: 'await',
        coverage: { id: 'cov-b', payer: 'Blue Plan' },
        waitMs: 1,
        balanceCents: 1
      }
    );
    assert.ok(html.includes('Waiting on Blue Plan'));
    assert.ok(html.includes('<option value="cov-b" selected="">Blue Plan</option>'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('Claim #12') && html.includes('Patient #3'));
    assert.ok(html.includes('Encounter PCR-1001'));
    assert.ok(html.includes('12.4 miles loaded'));
    assert.ok(html.includes('A0427'));
    assert.ok(html.includes('1. </span>Medicare'));
    assert.ok(html.includes('2. </span>Blue Plan'));
    assert.ok(html.includes('aria-label="Move Blue Plan up"'));
    assert.ok(html.includes('aria-label="Remove Blue Plan"'));
    assert.match(html, /History<span[^>]*tabular-nums[^>]*>2<\/span>/);
    assert.ok(html.includes('>Patient<'));
    assert.equal(html.match(/Not in Payer Directory/g)?.length, 1);
    assert.ok(html.includes('Service Date'));
    assert.ok(html.includes('for="response-paid"'));
    assert.ok(
      html.includes('href="/claims/c1?tab=data"') && html.includes('href="/claims/c1?tab=history"')
    );
    assert.ok(!html.includes('View PDF'));
    assert.ok(html.includes('>Post Payment<'));
    const history = render({}, null, 'history');
    assert.ok(history.includes('$50.00 paid'));
    assert.ok(history.includes('href="/docs/e2"'));
    assert.equal(history.match(/View PDF/g)?.length, 1);
    assert.ok(render({}, null, 'data').includes('Date of Service'));
  });

  it('defaults payments to the patient once no payer is being billed', () => {
    const html = render({}, { step: 'awaitPatient', waitMs: 1, balanceCents: 1 });
    assert.ok(html.includes('<option value="" selected="">Patient</option>'));
  });

  it('links to the cycle run when it has stopped', () => {
    const html = render({ cycle_status: 'failed' });
    assert.ok(html.includes('href="/runs/cycle-1"'));
    assert.ok(html.includes('>Restart Payer Cycle<'));
    const faulted = render({ cycle_status: 'faulted' });
    assert.ok(!faulted.includes('Restart Payer Cycle'));
  });

  it('locks editing while a draft and shows each task it is waiting on', () => {
    const task = {
      id: 't1',
      title: 'Confirm patient',
      subject: 'PCR-1',
      queue: 'billing-patients',
      kind: 'task',
      assignee_id: null,
      assignee_email: null,
      created_at: '2026-10-01T00:00:00Z'
    } as const;
    const html = render({
      status: 'draft',
      patient_id: null,
      patient_number: null,
      first_name: null,
      last_name: null,
      birth_date: null,
      tasks: [task, { ...task, id: 't2', kind: 'fault', title: 'Stuck at Price' }]
    });
    assert.equal(html.match(/<fieldset disabled=""/g)?.length, 4);
    assert.ok(html.includes('Patient not matched yet'));
    assert.ok(!html.includes('href="/patients/'));
    assert.ok(html.includes('Confirm patient') && html.includes('Patient Matching · Unassigned'));
    assert.ok(html.includes('href="/tasks/t1?back=%2Fclaims%2Fc1"'));
    assert.ok(html.includes('href="/tasks/t2?back='));
    assert.equal(html.match(/>Work Task</g)?.length, 2);
  });

  it('locks editing once the claim is closed', () => {
    const html = render({ status: 'paid', payers: [], coverages: [] });
    assert.ok(html.includes('>Paid<'));
    assert.ok(html.includes('The patient will be billed directly'));
    assert.equal(html.match(/<fieldset disabled=""/g)?.length, 2);
    const data = render({ status: 'paid', payers: [], coverages: [] }, null, 'data');
    assert.equal(data.match(/<fieldset disabled=""/g)?.length, 1);
  });
});

describe('ClaimView submission', () => {
  it('has no buttons to create or mark the 837P file, which the cycle files once approved', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimView, {
        claim,
        issues: [],
        files: [],
        history: loaded([]),
        progress: { step: 'submit', coverage: medicare, balanceCents: 1 },
        onSavePayers: async () => undefined,
        onRecord: async () => true,
        onRestart: async () => undefined,
        onSaveData: async () => true,
        onCheckEligibility: async () => undefined,
        onDownloadEligibility: async () => undefined,
        documentUrl: () => '',
        submission: { fileUrl: (id) => `/files/${id}`, encounterUrl: (id) => `/encounters/${id}` }
      })
    );
    assert.ok(html.includes('Approved. Creating its 837P file for Medicare'));
    assert.ok(!html.includes('Create 837P File') && !html.includes('Mark Submitted'));
    assert.ok(html.includes('href="/patients/p1"'));
  });
});

describe('EventsTable', () => {
  it('links submissions to the 837P file they went out in', () => {
    const html = renderToStaticMarkup(
      createElement(EventsTable, {
        events: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: '837P batch #4',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b4',
            batch_number: 4
          }
        ],
        documentUrl: () => '',
        fileUrl: (id) => `/files/${id}`
      })
    );
    assert.ok(html.includes('href="/files/b4"') && /837P File #(<!-- -->)?4/.test(html));
  });
});

describe('ClaimFiles', () => {
  it('lists the encounter, 837P files and documents for the claim', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: {
          import_report_id: 'r1',
          pcr_number: 'PCR-1',
          import_id: 'i1',
          import_file_name: 'october.xml'
        },
        payerFiles: [
          {
            id: 'pf1',
            kind: '999',
            file_name: 'ack.999',
            created_at: '2026-10-03T00:00:00Z',
            items: [{ outcome: 'rejected', message: 'Invalid member ID' }]
          }
        ],
        back: '/claims/c1',
        files: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: '837P file #7',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b7',
            batch_number: 7,
            batch_sent_at: '2026-10-02T00:01:00Z'
          },
          {
            id: 'e2',
            kind: 'statement',
            coverage_id: null,
            payer: null,
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: 'Patient statement 1 of 3',
            created_at: '2026-10-03T00:00:00Z',
            has_document: true
          }
        ],
        documentUrl: (id) => `/docs/${id}`,
        fileUrl: (id) => `/files/${id}`,
        encounterUrl: (id) => `/encounters/${id}`
      })
    );
    assert.ok(html.includes('href="/encounters/r1"') && html.includes('Encounter PCR-1'));
    assert.ok(html.includes('href="/files/b7"') && html.includes('837P File #7'));
    assert.ok(html.includes('>Sent '));
    assert.ok(html.includes('href="/docs/e2"') && html.includes('Patient statement 1 of 3'));
    assert.ok(
      html.includes('href="/imports/i1?back=%2Fclaims%2Fc1"') && html.includes('october.xml')
    );
    assert.ok(
      html.includes('href="/payer-files/pf1?back=%2Fclaims%2Fc1"') && html.includes('ack.999')
    );
    assert.ok(html.includes('Rejected') && html.includes('Invalid member ID'));
    const bare = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: {
          import_report_id: null,
          pcr_number: null,
          import_id: null,
          import_file_name: null
        },
        files: [],
        payerFiles: [],
        back: '/claims',
        documentUrl: () => '',
        fileUrl: () => '',
        encounterUrl: () => ''
      })
    );
    assert.ok(bare.includes('No source encounter file.'));
    const unsent = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: {
          import_report_id: 'r1',
          pcr_number: null,
          import_id: null,
          import_file_name: null
        },
        files: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            paid_on: null,
            check_number: null,
            payer_claim_number: null,
            note: '',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b8',
            batch_number: 8,
            batch_sent_at: null
          }
        ],
        payerFiles: [],
        back: '/claims',
        documentUrl: () => '',
        fileUrl: (id) => `/files/${id}`,
        encounterUrl: (id) => `/encounters/${id}`
      })
    );
    assert.ok(unsent.includes('Not sent; upload it to the clearinghouse'));
    assert.ok(unsent.includes('href="/encounters/r1"') && !unsent.includes('href="/imports/'));
  });
});
