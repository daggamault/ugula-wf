import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimEvent, ClaimLedger } from './claims.ts';
import {
  appealOutcomeOf,
  denialFactsOf,
  patientBalanceFactsOf,
  payerFactsOf,
  refundFactsOf
} from './recovery.ts';

const event = (patch: Partial<ClaimEvent> & Pick<ClaimEvent, 'kind'>): ClaimEvent => ({
  coverageId: 'mcr',
  paidCents: 0,
  adjustedCents: 0,
  payerClaimNumber: null,
  paidOn: null,
  adjustments: [],
  note: '',
  at: '2026-03-01T10:00:00.000Z',
  ...patch
});

const ledger = (events: ClaimEvent[], patch: Partial<ClaimLedger> = {}): ClaimLedger => ({
  totalCents: 100_000,
  coverages: [
    {
      id: 'mcr',
      payer: 'Medicare',
      claimFiling: 'MB',
      correctionMethod: null,
      appealDays: null,
      planType: 'government'
    },
    { id: 'blue', payer: 'Blue Plan', claimFiling: 'BL', appealDays: 90, planType: 'fully_insured' }
  ],
  events,
  ...patch
});

const denial = [
  event({ kind: 'submitted', payerClaimNumber: 'ICN-1' }),
  event({
    kind: 'response',
    paidOn: '2026-03-02',
    adjustments: [{ group: 'CO', reason: '50', cents: 100_000 }]
  }),
  event({ kind: 'denied', route: 'appeal', note: 'Not medically necessary' })
];

describe('denialFactsOf', () => {
  it('states the denial a biller works: payer, route, codes, date and payer settings', () => {
    assert.deepEqual(denialFactsOf(ledger([...denial, event({ kind: 'appealed' })]), 'mcr'), {
      coverageId: 'mcr',
      payer: 'Medicare',
      payerKind: 'MB',
      route: 'appeal',
      note: 'Not medically necessary',
      codes: ['CO-50'],
      paidCents: 0,
      balanceCents: 100_000,
      deniedOn: '2026-03-02',
      appeals: 1,
      payerClaimNumber: 'ICN-1',
      correctionMethod: null,
      appealDays: null
    });
    assert.throws(() => denialFactsOf(ledger([]), 'gone'), /not on the claim/);
  });
});

describe('payerFactsOf', () => {
  it('names any payer on the claim, not only the one billed, or the patient', () => {
    assert.deepEqual(payerFactsOf(ledger([]), 'blue'), { payer: 'Blue Plan', payerKind: 'BL' });
    assert.deepEqual(payerFactsOf(ledger([]), null), { payer: null, payerKind: 'patient' });
    assert.throws(() => payerFactsOf(ledger([]), 'gone'), /not on the claim/);
  });
});

describe('appealOutcomeOf', () => {
  it('decides an appeal only from a response the payer sent after it', () => {
    const sent = [...denial, event({ kind: 'appealed' })];
    assert.equal(appealOutcomeOf(ledger(sent), 'mcr').decided, false);
    const paid = appealOutcomeOf(
      ledger([...sent, event({ kind: 'response', paidCents: 60_000 })]),
      'mcr'
    );
    assert.deepEqual(paid, {
      decided: true,
      paidCents: 60_000,
      deniedAgain: false,
      balanceCents: 40_000
    });
    assert.equal(appealOutcomeOf(ledger(denial), 'mcr').decided, false);
  });
});

describe('refundFactsOf', () => {
  it('names the overpaid amount and who paid last, or the patient', () => {
    const paid = ledger([
      event({ kind: 'response', paidCents: 80_000 }),
      event({ kind: 'response', coverageId: 'blue', paidCents: 30_000, paidOn: '2026-04-01' })
    ]);
    assert.deepEqual(refundFactsOf(paid), {
      overpaidCents: 10_000,
      coverageId: 'blue',
      payer: 'Blue Plan',
      payerKind: 'BL',
      paidCents: 30_000,
      identifiedOn: '2026-04-01'
    });
    const patient = refundFactsOf(
      ledger([event({ kind: 'response', coverageId: null, paidCents: 120_000 })])
    );
    assert.deepEqual([patient.payerKind, patient.overpaidCents], ['patient', 20_000]);
  });
});

describe('patientBalanceFactsOf', () => {
  it('reads the cost share the last payer stated and what decides state protection', () => {
    const facts = patientBalanceFactsOf(
      ledger(
        [
          event({
            kind: 'response',
            coverageId: 'blue',
            paidCents: 50_000,
            adjustedCents: 0,
            adjustments: [{ group: 'PR', reason: '2', cents: 5_000 }]
          }),
          event({ kind: 'balance_protected', coverageId: null, adjustedCents: 45_000 })
        ],
        { pickupState: 'NH', serviceDate: '2026-02-01' }
      )
    );
    assert.deepEqual(facts, {
      balanceCents: 5_000,
      costShareCents: 5_000,
      state: 'NH',
      serviceDate: '2026-02-01',
      planType: 'fully_insured',
      payerKind: 'BL',
      protectedCents: 45_000
    });
    assert.equal(patientBalanceFactsOf(ledger([])).payerKind, 'patient');
  });
});
