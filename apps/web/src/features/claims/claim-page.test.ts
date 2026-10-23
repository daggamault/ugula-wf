import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  amountOf,
  ClaimView,
  describeCycle,
  describeProgress,
  moveItem,
  toResponse
} from './claim-page.tsx';
import type { ClaimDetail, ClaimProgress } from './client.ts';

const claim: ClaimDetail = {
  id: 'c1',
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 114_220,
  payers: ['Medicare', 'Blue Plan'],
  status: 'open',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe',
  emergency: true,
  loaded_miles: '12.4',
  lines: [{ code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 }],
  birth_date: '1958-04-12',
  patient_id: 'p1',
  cycle_run_id: 'cycle-1',
  cycle_status: 'suspended',
  coverages: [{ payer: 'Medicare', payerCode: null, memberId: '1EG4', groupId: null }],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, addressLine: '9 Elm St', city: null, state: 'IL', postalCode: '62704' },
    destination: { name: 'St. Mary', addressLine: null, city: null, state: null, postalCode: null },
    diagnoses: ['R079', 'I10'],
    originDestination: null
  },
  gender: 'F',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62704'
};

const render = (over: Partial<ClaimDetail> = {}, progress: ClaimProgress | null = null) =>
  renderToStaticMarkup(
    createElement(ClaimView, {
      claim: { ...claim, ...over },
      events: [
        {
          id: 'e1',
          kind: 'response',
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
      describeProgress({ step: 'await', payer: 'Medicare', waitMs: 1, balanceCents: 1 }) ?? '',
      /^Waiting on Medicare/
    );
    assert.match(
      describeProgress({ step: 'followUp', payer: 'Medicare', balanceCents: 1 }) ?? '',
      /billing-followup/
    );
    assert.equal(
      describeProgress({ step: 'statement', statement: 2, balanceCents: 1 }),
      'Sending patient statement 2 of 3.'
    );
  });
});

describe('describeCycle', () => {
  const waiting = { step: 'await', payer: 'Medicare', waitMs: 1, balanceCents: 1 } as const;
  it('reports a stopped, stuck or missing cycle instead of the expected next step', () => {
    assert.equal(
      describeCycle({ status: 'open', cycle_status: 'suspended' }, waiting)?.tone,
      'info'
    );
    const failed = describeCycle({ status: 'open', cycle_status: 'failed' }, waiting);
    assert.equal(failed?.tone, 'danger');
    assert.match(failed?.text ?? '', /payer cycle failed/);
    assert.match(
      describeCycle({ status: 'open', cycle_status: 'cancelled' }, waiting)?.text ?? '',
      /was cancelled/
    );
    assert.match(
      describeCycle({ status: 'open', cycle_status: 'faulted' }, waiting)?.text ?? '',
      /exceptions queue/
    );
    assert.equal(describeCycle({ status: 'open', cycle_status: null }, null)?.tone, 'warning');
    assert.equal(describeCycle({ status: 'paid', cycle_status: 'completed' }, null), null);
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
      toResponse({ payer: 'Medicare', paid: '600', adjusted: '100.5', note: ' ok ' }),
      {
        payer: 'Medicare',
        paidCents: 60_000,
        adjustedCents: 10_050,
        note: 'ok'
      }
    );
    assert.deepEqual(toResponse({ payer: 'Medicare', paid: '', adjusted: '', note: '' }), {
      payer: 'Medicare',
      paidCents: 0,
      adjustedCents: 0,
      note: ''
    });
    assert.equal(
      toResponse({ payer: '', paid: '', adjusted: '', note: '' }),
      'A patient payment needs an amount'
    );
    assert.equal(
      toResponse({ payer: '', paid: '-1', adjusted: '', note: '' }),
      'Enter amounts of zero or more'
    );
  });
});

describe('ClaimView', () => {
  it('shows lines, ordered payers, history and the response form for open claims', () => {
    const html = render({}, { step: 'await', payer: 'Blue Plan', waitMs: 1, balanceCents: 1 });
    assert.ok(html.includes('Waiting on Blue Plan'));
    assert.ok(html.includes('<option value="Blue Plan" selected="">'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('12.4 loaded miles'));
    assert.ok(html.includes('A0427'));
    assert.ok(html.includes('1. </span>Medicare'));
    assert.ok(html.includes('2. </span>Blue Plan'));
    assert.ok(html.includes('aria-label="Move Blue Plan up"'));
    assert.ok(html.includes('>Patient<'));
    assert.ok(html.includes('$50.00 paid'));
    assert.ok(html.includes('href="/docs/e2"'));
    assert.equal(html.match(/View PDF/g)?.length, 1);
    assert.ok(html.includes('for="response-paid"'));
  });

  it('defaults payments to the patient once no payer is being billed', () => {
    const html = render({}, { step: 'awaitPatient', waitMs: 1, balanceCents: 1 });
    assert.ok(html.includes('<option value="" selected="">Patient</option>'));
  });

  it('links to the cycle run when it has stopped', () => {
    const html = render({ cycle_status: 'failed' });
    assert.ok(html.includes('href="/runs/cycle-1"'));
    assert.ok(html.includes('>Restart payer cycle<'));
    assert.ok(!render({ cycle_status: 'faulted' }).includes('Restart payer cycle'));
  });

  it('locks editing once the claim is closed', () => {
    const html = render({ status: 'paid', payers: [] });
    assert.ok(html.includes('>Paid<'));
    assert.ok(html.includes('The patient will be billed directly'));
    assert.equal(html.match(/<fieldset disabled=""/g)?.length, 3);
  });
});
