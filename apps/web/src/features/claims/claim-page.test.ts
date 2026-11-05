import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimIssue } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Page } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import { type ClaimTab, ClaimView, lockedReason } from './claim-page.tsx';
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
      eligibility_checked_at: null,
      stay_kind: null,
      stay_admitted_on: null,
      stay_discharged_on: null
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
      eligibility_checked_at: null,
      stay_kind: null,
      stay_admitted_on: null,
      stay_discharged_on: null
    }
  ],
  diagnoses: ['R079', 'I10'],
  facility_id: null,
  facility_name: null,
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
  patient_count: null,
  closest_facility_miles: null,
  abn_on_file: null,
  abn_signed_on: null,
  denial_expected: null,
  msp_employer_plan: null,
  msp_esrd: null,
  msp_disability: null,
  msp_accident: null,
  prior_authorization_expires_on: null,
  pcs_type: null,
  round_trips: null,
  admission_date: null,
  facility_stay: null,
  deceased: false,
  non_covered_miles: null,
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

describe('lockedReason', () => {
  it('locks drafts and closed claims with a reason', () => {
    assert.equal(lockedReason('submitted'), undefined);
    assert.match(lockedReason('draft') ?? '', /still a draft/);
    assert.equal(lockedReason('void'), 'This claim is closed.');
  });
});

describe('ClaimView', () => {
  it('shows the trip type and the claim check issues of an open claim', () => {
    const issues: ClaimIssue[] = [
      {
        code: 'member-id-missing',
        severity: 'blocking',
        field: 'memberId',
        message: 'Member ID missing',
        coverageId: 'cov-b'
      }
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
      due_at: null,
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
