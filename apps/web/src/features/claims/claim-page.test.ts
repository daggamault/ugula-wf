import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  amountOf,
  ClaimFiles,
  type ClaimTab,
  ClaimView,
  describeCycle,
  describeProgress,
  EventsTable,
  lockedReason,
  moveItem,
  toResponse
} from './claim-page.tsx';
import type { ClaimDetail, ClaimProgress } from './client.ts';

const claim: ClaimDetail = {
  id: 'c1',
  number: 12,
  patient_number: 3,
  import_report_id: 'r1',
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
      group_id: null
    },
    {
      id: 'cov-b',
      position: 2,
      payer: 'Blue Plan',
      payer_id: null,
      payer_code: null,
      member_id: null,
      group_id: null
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
  tasks: [],
  task_id: null,
  task_title: null,
  task_queue: null,
  task_kind: null,
  task_assignee_email: null,
  open_tasks: 0
};

const medicare = { id: 'cov-m', payer: 'Medicare' };

const render = (
  over: Partial<ClaimDetail> = {},
  progress: ClaimProgress | null = null,
  tab: ClaimTab = 'overview'
) =>
  renderToStaticMarkup(
    createElement(ClaimView, {
      claim: { ...claim, ...over },
      tab,
      events: [
        {
          id: 'e1',
          kind: 'response',
          coverage_id: null,
          payer: null,
          paid_cents: 5_000,
          adjusted_cents: 0,
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
          note: 'Patient statement 1 of 3',
          created_at: '2026-10-03T00:00:00Z',
          has_document: true
        }
      ],
      progress,
      onSavePayers: async () => undefined,
      onRecord: async () => true,
      onRestart: async () => undefined,
      onSaveData: async () => true,
      documentUrl: (eventId: string) => `/docs/${eventId}`
    })
  );

describe('amountOf', () => {
  it('describes paid and adjusted amounts together', () => {
    assert.equal(
      amountOf({ paid_cents: 40_000, adjusted_cents: 10_000 }),
      '$400.00 paid · $100.00 adjusted'
    );
    assert.equal(amountOf({ paid_cents: 0, adjusted_cents: 0 }), '');
  });
});

describe('describeProgress', () => {
  it('tells billers what the claim cycle is doing', () => {
    assert.equal(describeProgress(null), null);
    assert.match(
      describeProgress({ step: 'await', coverage: medicare, waitMs: 1, balanceCents: 1 }) ?? '',
      /^Waiting on Medicare/
    );
    assert.match(
      describeProgress({ step: 'followUp', coverage: medicare, balanceCents: 1 }) ?? '',
      /follow-up task is waiting/
    );
    assert.match(
      describeProgress({ step: 'review', coverage: medicare, balanceCents: 1 }) ?? '',
      /^Needs review before it goes to Medicare/
    );
    assert.match(
      describeProgress({ step: 'reconcile', coverage: medicare, balanceCents: 1 }) ?? '',
      /reconcile task is waiting/
    );
    assert.equal(
      describeProgress({ step: 'statement', statement: 2, balanceCents: 1 }),
      'Sending patient statement 2 of 3.'
    );
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
    assert.equal(describeCycle({ status: 'ready', cycle_status: null }, null)?.intent, 'warning');
    assert.equal(describeCycle({ status: 'paid', cycle_status: 'completed' }, null), null);
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
    assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b']);
  });
});

describe('toResponse', () => {
  it('converts dollars to cents and treats a blank payer as the patient', () => {
    assert.deepEqual(
      toResponse({ coverageId: 'cov-m', paid: '600', adjusted: '100.5', note: ' ok ' }),
      {
        coverageId: 'cov-m',
        paidCents: 60_000,
        adjustedCents: 10_050,
        note: 'ok'
      }
    );
    assert.deepEqual(toResponse({ coverageId: 'cov-m', paid: '', adjusted: '', note: '' }), {
      coverageId: 'cov-m',
      paidCents: 0,
      adjustedCents: 0,
      note: ''
    });
    assert.equal(
      toResponse({ coverageId: '', paid: '', adjusted: '', note: '' }),
      'A patient payment needs an amount'
    );
    assert.equal(
      toResponse({ coverageId: '', paid: '-1', adjusted: '', note: '' }),
      'Enter amounts of zero or more'
    );
  });
});

describe('ClaimView', () => {
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
    assert.ok(html.includes('12.4 loaded miles'));
    assert.ok(html.includes('A0427'));
    assert.ok(html.includes('1. </span>Medicare'));
    assert.ok(html.includes('2. </span>Blue Plan'));
    assert.ok(html.includes('aria-label="Move Blue Plan up"'));
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
    assert.equal(html.match(/<fieldset disabled=""/g)?.length, 2);
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
  const submission = (issues: string[] | null) => ({
    issues,
    made: null,
    fileUrl: (id: string) => `/files/${id}`,
    encounterUrl: (id: string) => `/encounters/${id}`,
    onCreateFile: async () => undefined,
    onMarkSubmitted: async () => undefined
  });
  const view = (issues: string[] | null) =>
    renderToStaticMarkup(
      createElement(ClaimView, {
        claim,
        events: [],
        progress: { step: 'submit', coverage: medicare, balanceCents: 1 },
        onSavePayers: async () => undefined,
        onRecord: async () => true,
        onRestart: async () => undefined,
        onSaveData: async () => true,
        documentUrl: () => '',
        submission: submission(issues)
      })
    );

  it('submits a ready claim from its own page and links its patient', () => {
    const html = view([]);
    assert.ok(html.includes('Ready to submit to Medicare.'));
    assert.ok(html.includes('Create 837P File') && html.includes('Mark Submitted'));
    assert.ok(!html.includes('Fix the problems listed first.'));
    assert.ok(html.includes('href="/patients/p1"'));
  });

  it('lists what blocks the 837P file', () => {
    const html = view(['Add the member ID']);
    assert.ok(html.includes('<li>Add the member ID</li>'));
    assert.ok(html.includes('Fix the problems listed first.'));
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
        claim: { import_report_id: 'r1', pcr_number: 'PCR-1' },
        events: [
          {
            id: 'e1',
            kind: 'submitted',
            coverage_id: 'cov-m',
            payer: 'Medicare',
            paid_cents: 0,
            adjusted_cents: 0,
            note: '837P file #7',
            created_at: '2026-10-02T00:00:00Z',
            has_document: false,
            batch_id: 'b7',
            batch_number: 7
          },
          {
            id: 'e2',
            kind: 'statement',
            coverage_id: null,
            payer: null,
            paid_cents: 0,
            adjusted_cents: 0,
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
    assert.ok(html.includes('href="/files/b7"') && html.includes('837P file #7'));
    assert.ok(html.includes('href="/docs/e2"') && html.includes('Patient statement 1 of 3'));
    const bare = renderToStaticMarkup(
      createElement(ClaimFiles, {
        claim: { import_report_id: null, pcr_number: null },
        events: [],
        documentUrl: () => '',
        fileUrl: () => '',
        encounterUrl: () => ''
      })
    );
    assert.ok(bare.includes('No source encounter file.'));
  });
});
