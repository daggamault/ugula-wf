import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimEvent, ClaimLedger } from './claims.ts';
import {
  appealOutcomeOf,
  denialFactsOf,
  patientBalanceFactsOf,
  payerFactsOf,
  refundFactsOf,
  responseFactsOf
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
  event({ kind: 'submitted', payerClaimNumber: 'ICN-0' }),
  event({
    kind: 'response',
    paidOn: '2026-03-02',
    payerClaimNumber: 'ICN-1',
    remarks: ['N115'],
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
      remarks: ['N115'],
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

  it('defaults to a plain denial with no codes or date before the payer answers', () => {
    const bare = ledger([event({ kind: 'submitted', coverageId: 'self' })], {
      coverages: [{ id: 'self', payer: 'Self Plan' }]
    });
    assert.deepEqual(denialFactsOf(bare, 'self'), {
      coverageId: 'self',
      payer: 'Self Plan',
      payerKind: null,
      route: 'denial',
      note: '',
      codes: [],
      remarks: [],
      paidCents: 0,
      balanceCents: 100_000,
      deniedOn: null,
      appeals: 0,
      payerClaimNumber: null,
      correctionMethod: null,
      appealDays: null
    });
    assert.deepEqual(payerFactsOf(bare, 'self'), { payer: 'Self Plan', payerKind: null });
  });

  it('dates the denial from when the response arrived when it carries no paid date', () => {
    const facts = denialFactsOf(
      ledger([event({ kind: 'response', at: '2026-03-04T23:00:00.000Z' })]),
      'mcr'
    );
    assert.deepEqual([facts.deniedOn, facts.route, facts.remarks], ['2026-03-04', 'denial', []]);
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
  it('names the overpaid amount and the payer whose payment made the credit, or the patient', () => {
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
    const later = refundFactsOf(
      ledger([
        event({ kind: 'response', paidCents: 80_000, paidOn: '2026-03-02' }),
        event({ kind: 'response', coverageId: 'blue', paidCents: 30_000, paidOn: '2026-04-01' }),
        event({ kind: 'response', paidCents: 0, adjustedCents: 0, paidOn: '2026-05-01' }),
        event({ kind: 'statement', coverageId: null, at: '2026-05-02T10:00:00.000Z' })
      ])
    );
    assert.deepEqual(
      [later.coverageId, later.paidCents, later.identifiedOn],
      ['blue', 30_000, '2026-04-01']
    );
    const settledThenOver = refundFactsOf(
      ledger([
        event({ kind: 'response', coverageId: 'blue', paidCents: 110_000, paidOn: '2026-03-02' }),
        event({ kind: 'refunded', coverageId: 'blue', paidCents: -10_000, paidOn: '2026-03-20' }),
        event({ kind: 'response', paidCents: 5_000, paidOn: '2026-04-10' })
      ])
    );
    assert.deepEqual(
      [settledThenOver.coverageId, settledThenOver.overpaidCents, settledThenOver.identifiedOn],
      ['mcr', 5_000, '2026-04-10']
    );
    assert.deepEqual(
      [refundFactsOf(ledger([])).coverageId, refundFactsOf(ledger([])).identifiedOn],
      [null, null]
    );
  });
});

describe('patientBalanceFactsOf', () => {
  it('reads the adjustments the last payer sent and what decides state protection', () => {
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
      adjustments: [{ group: 'PR', reason: '2', cents: 5_000 }],
      claimFilings: ['MB', 'BL'],
      state: 'NH',
      serviceDate: '2026-02-01',
      planType: 'fully_insured',
      payerKind: 'BL',
      protectedCents: 45_000
    });
    assert.equal(patientBalanceFactsOf(ledger([])).payerKind, 'patient');
  });

  it('knows no plan type or filing kind for a payer that has none', () => {
    const facts = patientBalanceFactsOf(
      ledger(
        [
          event({ kind: 'response', coverageId: 'self', paidCents: 60_000 }),
          event({ kind: 'response', coverageId: null, paidCents: 10_000 })
        ],
        {
          coverages: [
            { id: 'self', payer: 'Self Plan' },
            { id: 'mcd', payer: 'State Medicaid', claimFiling: 'MC' }
          ]
        }
      )
    );
    assert.deepEqual(facts, {
      balanceCents: 30_000,
      adjustments: [],
      claimFilings: ['MC'],
      state: null,
      serviceDate: null,
      planType: null,
      payerKind: null,
      protectedCents: 0
    });
  });
});

describe('responseFactsOf', () => {
  it('adds up what one payer paid and gathers every adjustment it sent', () => {
    const paid = ledger([
      event({ kind: 'submitted' }),
      event({
        kind: 'response',
        paidCents: 43_000,
        adjustments: [
          { group: 'CO', reason: '45', cents: 40_000 },
          { group: 'PR', reason: '2', cents: 11_000 },
          { group: 'PR', reason: '96', cents: 15_000 },
          { group: 'CO', reason: '253', cents: 900 }
        ]
      }),
      event({ kind: 'response', coverageId: 'blue', paidCents: 5_000 })
    ]);
    assert.deepEqual(responseFactsOf(paid, 'mcr'), {
      paidCents: 43_000,
      adjustments: [
        { group: 'CO', reason: '45', cents: 40_000 },
        { group: 'PR', reason: '2', cents: 11_000 },
        { group: 'PR', reason: '96', cents: 15_000 },
        { group: 'CO', reason: '253', cents: 900 }
      ]
    });
    assert.deepEqual(responseFactsOf(ledger([]), 'blue'), { paidCents: 0, adjustments: [] });
    assert.throws(() => responseFactsOf(paid, 'nope'), /not on the claim/);
  });
});
