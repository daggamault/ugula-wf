import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimIssue } from '@ugula/billing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import { claimDetail as claim } from '../../shared/claims/testing.ts';
import type { Page } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import { type ClaimTab, ClaimView } from './claim-page.tsx';
import type { ClaimEvent, ClaimProgress } from './client.ts';

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
      codes: {},
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
      onDownloadEligibility: async () => undefined,
      documentUrl: (eventId: string) => `/docs/${eventId}`
    })
  );

describe('ClaimView', () => {
  it('shows the classification and the claim check issues of an open claim', () => {
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
    assert.ok(html.includes('Emergency Transport'));
    assert.ok(
      html.includes('Must Be Fixed') && html.includes('Member ID: </span>Member ID missing')
    );
    assert.ok(!render({ status: 'paid' }, null, 'overview', issues).includes('Must Be Fixed'));
  });

  it('leaves out the encounter number and says when there is no PCR number', () => {
    const html = render({ encounter_number: null, pcr_number: null, patient_number: null });
    assert.ok(html.includes('Claim 20261001-0012'));
    assert.ok(!html.includes('Encounter 2') && !html.includes('Patient 2'));
    assert.ok(html.includes('No PCR number'));
  });

  it('shows lines, ordered payers, documents and history without a single form', () => {
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
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('Claim 20261001-0012') && html.includes('Patient 20260915-0003'));
    assert.ok(html.includes('Encounter 20261001-0007') && html.includes('PCR PCR-1001'));
    assert.ok(html.includes('12.4 miles loaded'));
    assert.ok(html.includes('A0427'));
    assert.ok(html.includes('1. </span>Medicare') && html.includes('2. </span>Blue Plan'));
    assert.ok(html.includes('Member ID 1EG4'));
    assert.match(html, /History<span[^>]*tabular-nums[^>]*>2<\/span>/);
    assert.equal(html.match(/Not in Payer Directory/g)?.length, 1);
    assert.ok(
      html.includes('Responsible Facility') && html.includes('None: the payers and the patient')
    );
    assert.ok(
      html.includes('No documents are on this claim yet.') && html.includes('Download 270')
    );
    assert.ok(
      html.includes('href="/claims/c1?tab=data"') && html.includes('href="/claims/c1?tab=history"')
    );
    for (const tab of ['overview', 'data', 'history'] as const) {
      const page = render({}, null, tab);
      if (tab !== 'history') assert.ok(!/<form|<input|<select|<textarea|<fieldset/.test(page), tab);
      assert.ok(
        !/Post Payment|Save |Upload Document|Chase Document|Check Eligibility/.test(page),
        tab
      );
    }
    const history = render({}, null, 'history');
    assert.ok(history.includes('$50.00 paid') && history.includes('Check or EFT CHK-77'));
    assert.ok(history.includes('href="/docs/e2"'));
    assert.equal(history.match(/View PDF/g)?.length, 1);
  });

  it('shows the claim data read only on its tab', () => {
    const data = render({}, null, 'data');
    assert.ok(data.includes('Date of Service') && data.includes('R07.9') && data.includes('I10'));
    assert.ok(data.includes('1 Main St, Springfield, IL 62704') && data.includes('St. Mary'));
    assert.ok(data.includes('Correct Claim Data task'));
  });

  it('links to the cycle run when it has stopped and points at Start Task to restart it', () => {
    const html = render({ cycle_status: 'failed' });
    assert.ok(html.includes('href="/runs/cycle-1"'));
    assert.ok(html.includes('Restart it from Start Task.'));
    assert.ok(!html.includes('Restart Payer Cycle'));
    assert.ok(!render({ cycle_status: 'faulted' }).includes('Restart it'));
  });

  it('shows each task the claim is waiting on', () => {
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
    assert.ok(html.includes('Patient not matched yet'));
    assert.ok(!html.includes('href="/patients/'));
    assert.ok(html.includes('Confirm patient') && html.includes('Patient Matching · Unassigned'));
    assert.ok(html.includes('href="/tasks/t1?back=%2Fclaims%2Fc1"'));
    assert.equal(html.match(/>Work Task</g)?.length, 2);
  });

  it('puts the Start Task menu it is given in the header', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimView, {
        claim,
        issues: [],
        codes: {},
        files: [],
        history: loaded([]),
        progress: null,
        onDownloadEligibility: async () => undefined,
        documentUrl: () => '',
        startTask: createElement('button', { type: 'button' }, 'Start Task')
      })
    );
    assert.ok(html.includes('>Start Task<'));
  });
});

describe('ClaimView submission', () => {
  it('has no buttons to create or mark the 837P file, which the cycle files once approved', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimView, {
        claim,
        issues: [],
        codes: {},
        files: [],
        history: loaded([]),
        progress: { step: 'submit', coverage: medicare, balanceCents: 1 },
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
