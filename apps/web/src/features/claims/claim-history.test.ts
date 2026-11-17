import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import type { Page } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import {
  amountOf,
  ClaimHistory,
  EventsTable,
  noteOf,
  paymentDetailsOf,
  reasonsOf
} from './claim-history.tsx';
import type { ClaimEvent } from './client.ts';

const submitted: ClaimEvent = {
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
};

const paid: ClaimEvent = {
  ...submitted,
  id: 'e2',
  kind: 'response',
  payer: null,
  paid_cents: 40_000,
  adjusted_cents: 10_000,
  paid_on: '2026-10-20',
  check_number: 'EFT-9',
  payer_claim_number: 'ICN1',
  note: 'Paid by the patient',
  has_document: true,
  batch_id: null,
  batch_number: null,
  adjustments: [{ group: 'CO', reason: '45', cents: 10_000, description: null }],
  remarks: [{ code: 'N130', description: null }]
};

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
  });

  it('leaves out the details the payment did not come with', () => {
    assert.equal(
      paymentDetailsOf({ paid_on: null, check_number: 'EFT-9', payer_claim_number: null }),
      'Check or EFT EFT-9'
    );
    assert.equal(
      paymentDetailsOf({ paid_on: null, check_number: null, payer_claim_number: null }),
      ''
    );
  });
});

describe('noteOf', () => {
  it('names the status a claim closed as, and keeps other notes as written', () => {
    assert.equal(noteOf({ kind: 'closed', note: 'void' }), 'As Void');
    assert.equal(noteOf({ kind: 'closed', note: 'written_off' }), 'As Written Off');
    assert.equal(noteOf({ kind: 'statement', note: 'void' }), 'void');
  });
});

describe('amountOf', () => {
  it('describes paid and adjusted amounts together', () => {
    assert.equal(
      amountOf({ kind: 'response', paid_cents: 40_000, adjusted_cents: 10_000 }),
      '$400.00 paid · $100.00 adjusted'
    );
    assert.equal(
      amountOf({ kind: 'response', paid_cents: 0, adjusted_cents: 10_000 }),
      '$100.00 adjusted'
    );
    assert.equal(amountOf({ kind: 'response', paid_cents: 0, adjusted_cents: 0 }), '');
  });

  it('describes a refund as the amount paid back, whatever its sign', () => {
    assert.equal(
      amountOf({ kind: 'refunded', paid_cents: -2_500, adjusted_cents: 0 }),
      '$25.00 refunded'
    );
    assert.equal(
      amountOf({ kind: 'refunded', paid_cents: 2_500, adjusted_cents: 300 }),
      '$25.00 refunded'
    );
  });
});

describe('reasonsOf', () => {
  it('describes each adjustment with its group and amount, then each remark', () => {
    assert.deepEqual(
      reasonsOf({
        adjustments: [
          { group: 'CO', reason: '45', cents: 15_995, description: 'Charge exceeds fee schedule.' },
          { group: 'PR', reason: '999', cents: 100, description: null }
        ],
        remarks: [
          { code: 'N130', description: 'Consult plan benefit documents.' },
          { code: 'MA01', description: null }
        ]
      }),
      [
        {
          group: 'Contractual obligation',
          value: { text: 'Charge exceeds fee schedule.', code: 'CO-45' },
          amount: '$159.95'
        },
        { group: 'Patient responsibility', value: { text: 'PR-999', code: null }, amount: '$1.00' },
        {
          group: null,
          value: { text: 'Consult plan benefit documents.', code: 'N130' },
          amount: null
        },
        { group: null, value: { text: 'MA01', code: null }, amount: null }
      ]
    );
  });

  it('has no reasons for an event without adjustments or remarks', () => {
    assert.deepEqual(reasonsOf({}), []);
  });
});

const showTable = (events: ClaimEvent[], fileUrl?: (id: string) => string) =>
  render(createElement(EventsTable, { events, documentUrl: (id) => `/docs/${id}`, fileUrl }));

const rowsOf = () =>
  within(screen.getByRole('table', { name: 'Claim history' })).getAllByRole('row');

describe('EventsTable', () => {
  it('shows when, what, which payer, how much and why for each event', () => {
    showTable([submitted, paid], (id) => `/files/${id}`);
    const rows = rowsOf();
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.slice(1).map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent)
      ),
      [
        [
          formatDateTime(submitted.created_at),
          'EventSubmitted',
          'ByAutomatic',
          'PayerMedicare',
          'Amount',
          'Note837P batch #4837P File #4'
        ],
        [
          formatDateTime(paid.created_at),
          'EventResponse',
          'ByAutomatic',
          'PayerPatient',
          'Amount$400.00 paid · $100.00 adjusted',
          'NotePaid Oct 20, 2026 · Check or EFT EFT-9 · Payer claim ICN1Contractual obligation: CO-45 · $100.00N130Paid by the patientView PDF'
        ]
      ]
    );
  });

  it('links submissions to the 837P file they went out in', () => {
    showTable([submitted], (id) => `/files/${id}`);
    const link = screen.getByRole('link', { name: '837P File #4' });
    assert.equal(link.getAttribute('href'), '/files/b4');
    assert.equal(link.hasAttribute('download'), true);
  });

  it('links no 837P file when there is no way to download it', () => {
    showTable([submitted]);
    assert.ok(!screen.queryByRole('link'));
  });

  it('opens the PDF an event came with in a new tab', () => {
    showTable([paid]);
    const link = screen.getByRole('link', { name: 'View PDF' });
    assert.equal(link.getAttribute('href'), '/docs/e2');
    assert.equal(link.getAttribute('target'), '_blank');
  });

  it('shows a dash for an event with no payer that is not a response', () => {
    showTable([{ ...submitted, kind: 'statement', payer: null }]);
    const payer = within(rowsOf()[1] as HTMLElement).getAllByRole('cell')[3];
    assert.equal(payer?.textContent, 'Payer—');
  });

  it('shows who decided, the task, its outcome, what was set and the note', () => {
    showTable([
      {
        ...submitted,
        kind: 'decided',
        payer: null,
        batch_id: null,
        by: 'Pat Biller',
        note: 'No patient contact; crew was cancelled en route',
        decision: {
          task: 'Review classification',
          outcome: 'skipClaim',
          values: [{ label: 'Classification', value: 'Not Billable' }]
        }
      },
      {
        ...submitted,
        id: 'e9',
        kind: 'decided',
        payer: null,
        batch_id: null,
        note: 'Classified as Emergency Transport · Patient transported by this unit'
      }
    ]);
    const [manual, automatic] = rowsOf()
      .slice(1)
      .map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent)
      );
    assert.deepEqual(manual?.slice(1, 3), ['EventDecision', 'ByPat Biller']);
    assert.equal(
      manual?.at(-1),
      'NoteReview classification: Skip ClaimClassification: Not BillableNo patient contact; crew was cancelled en route'
    );
    assert.deepEqual(automatic?.slice(1, 3), ['EventDecision', 'ByAutomatic']);
    assert.equal(
      automatic?.at(-1),
      'NoteClassified as Emergency Transport · Patient transported by this unit'
    );
  });
});

const resource = (over: Partial<Resource<Page<ClaimEvent>>>): Resource<Page<ClaimEvent>> => ({
  data: undefined,
  error: undefined,
  loading: false,
  reload: () => undefined,
  ...over
});

const showHistory = (history: Resource<Page<ClaimEvent>>) =>
  render(
    createElement(ClaimHistory, {
      claimId: 'c1',
      history,
      documentUrl: (id) => `/docs/${id}`
    })
  );

describe('ClaimHistory', () => {
  it('shows it is loading until the history arrives', () => {
    showHistory(resource({ loading: true }));
    assert.ok(screen.getByLabelText('Loading'));
    assert.ok(!screen.queryByRole('table'));
  });

  it('lists the events with how many there are', () => {
    showHistory(resource({ data: { items: [paid], total: 1, page: 1, pageSize: 25 } }));
    assert.equal(rowsOf().length, 2);
    assert.ok(screen.getByText('1–1 of 1'));
  });

  it('pages a long history', () => {
    window.history.replaceState(null, '', '/claims/c1?historyPage=2');
    showHistory(resource({ data: { items: [paid], total: 30, page: 2, pageSize: 25 } }));
    const pages = screen.getByRole('navigation', { name: 'Claim history pages' });
    assert.equal(within(pages).getByText(/of 30/).textContent, '26–30 of 30 · Page 2 of 2');
  });

  it('says when nothing has happened on the claim yet', () => {
    showHistory(resource({ data: { items: [], total: 0, page: 1, pageSize: 25 } }));
    assert.ok(screen.getByText('Nothing has happened on this claim yet.'));
  });

  it('says why the history could not be loaded', () => {
    showHistory(
      resource({
        error: new Error('History is unavailable'),
        data: { items: [paid], total: 1, page: 1, pageSize: 25 }
      })
    );
    assert.equal(screen.getByRole('alert').textContent, 'History is unavailable');
    assert.ok(!screen.queryByRole('table'));
  });
});
