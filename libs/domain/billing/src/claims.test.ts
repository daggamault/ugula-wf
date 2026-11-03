import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_SIGNAL,
  type ClaimEvent,
  claimProgress,
  claimSignalKey,
  isClosedStatus,
  MIN_WAIT_MS,
  nextClaimStep,
  stageOf
} from './claims.ts';

const DAY = 86_400_000;
const start = Date.parse('2026-01-01T00:00:00.000Z');
const day = (n: number) => new Date(start + n * DAY);

const cov = (payer: string) => ({ id: `cov-${payer}`, payer });

const e = (
  kind: ClaimEvent['kind'],
  payer: string | null,
  onDay: number,
  paid = 0,
  adjusted = 0
): ClaimEvent => ({
  kind,
  coverageId: payer === null ? null : cov(payer).id,
  paidCents: paid,
  adjustedCents: adjusted,
  payerClaimNumber: null,
  paidOn: null,
  adjustments: [],
  note: '',
  at: day(onDay).toISOString()
});

const step = (events: ClaimEvent[], onDay: number, payers = ['Medicare', 'Blue Plan']) =>
  nextClaimStep({ totalCents: 100_000, coverages: payers.map(cov), events }, day(onDay));

describe('nextClaimStep', () => {
  it('asks for review before each payer, then submits and waits out its 30 days', () => {
    assert.deepEqual(step([], 0), {
      step: 'review',
      coverage: cov('Medicare'),
      balanceCents: 100_000
    });
    assert.equal(step([e('approved', 'Blue Plan', 0)], 0).step, 'review');
    assert.deepEqual(step([e('approved', 'Medicare', 0)], 0), {
      step: 'submit',
      coverage: cov('Medicare'),
      balanceCents: 100_000
    });
    assert.deepEqual(step([e('submitted', 'Medicare', 0)], 0), {
      step: 'await',
      coverage: cov('Medicare'),
      waitMs: 30 * DAY,
      balanceCents: 100_000
    });
    assert.equal(
      step([e('submitted', 'Medicare', 0)], 29.5).step === 'await' &&
        (step([e('submitted', 'Medicare', 0)], 29.5) as { waitMs: number }).waitMs,
      DAY / 2
    );
  });

  it('never waits less than a minute, so clock skew cannot spin the cycle', () => {
    const almost = step([e('submitted', 'Medicare', 0)], 30 - 5_000 / DAY);
    assert.equal(almost.step === 'await' && almost.waitMs, MIN_WAIT_MS);
  });

  it('asks for a follow-up after 30 days, and a follow-up decision restarts the clock', () => {
    const sent = [e('submitted', 'Medicare', 0)];
    assert.deepEqual(step(sent, 30), {
      step: 'followUp',
      coverage: cov('Medicare'),
      balanceCents: 100_000
    });
    assert.equal(step([...sent, e('follow_up', 'Medicare', 30)], 31).step, 'await');
    assert.equal(step([...sent, e('resubmitted', 'Medicare', 30)], 59).step, 'await');
  });

  it('puts a claim back in line for the next batch when a resubmission is queued', () => {
    const queued = [
      e('approved', 'Medicare', 0),
      e('submitted', 'Medicare', 0),
      e('resubmit_queued', 'Medicare', 30)
    ];
    assert.equal(step(queued, 31).step, 'review');
    assert.equal(step([...queued, e('approved', 'Medicare', 31)], 31).step, 'submit');
    assert.equal(
      claimProgress({ totalCents: 1, coverages: [cov('Medicare')], events: queued })
        .submittedBefore,
      true
    );
    assert.equal(step([...queued, e('resubmitted', 'Medicare', 32)], 33).step, 'await');
  });

  it('lists the payers that already answered ahead of the one being billed', () => {
    const ledger = {
      totalCents: 100_000,
      coverages: ['Medicare', 'Blue Plan', 'Aetna'].map(cov),
      events: [e('response', 'Medicare', 1, 50_000), e('payer_skipped', 'Blue Plan', 2)]
    };
    assert.deepEqual(claimProgress(ledger).priorCoverages, [
      {
        ...cov('Medicare'),
        paidCents: 50_000,
        adjustedCents: 0,
        paidOn: '2026-01-02',
        adjustments: []
      }
    ]);
    assert.deepEqual(claimProgress(ledger).coverage, cov('Aetna'));
    assert.equal(claimProgress(ledger).submittedBefore, false);
  });

  it('tracks payers by coverage, so reordering, out-of-order responses and skips never re-bill', () => {
    const both = [
      e('submitted', 'Medicare', 0),
      e('response', 'Medicare', 5, 50_000),
      e('reconciled', 'Medicare', 5),
      e('submitted', 'Blue Plan', 5),
      e('response', 'Blue Plan', 9, 10_000),
      e('reconciled', 'Blue Plan', 9)
    ];
    assert.equal(step(both, 10, ['Blue Plan', 'Medicare']).step, 'reviewPatient');
    assert.equal(
      step([...both, e('approved', null, 10)], 10, ['Blue Plan', 'Medicare']).step,
      'statement'
    );
    assert.deepEqual(
      step([e('response', 'Blue Plan', 1, 5_000), e('reconciled', 'Blue Plan', 1)], 2),
      { step: 'review', coverage: cov('Medicare'), balanceCents: 95_000 }
    );
    assert.equal(
      step(
        [
          e('response', 'Blue Plan', 1),
          e('reconciled', 'Blue Plan', 1),
          e('response', 'Medicare', 2),
          e('reconciled', 'Medicare', 2),
          e('approved', null, 2)
        ],
        3
      ).step,
      'statement'
    );
    assert.deepEqual(step([e('payer_skipped', 'Medicare', 1)], 1), {
      step: 'review',
      coverage: cov('Blue Plan'),
      balanceCents: 100_000
    });
  });

  it('asks for every payer response that leaves a balance to be reconciled', () => {
    const answered = [e('submitted', 'Medicare', 0), e('response', 'Medicare', 5, 60_000)];
    assert.deepEqual(step(answered, 6), {
      step: 'reconcile',
      coverage: cov('Medicare'),
      balanceCents: 40_000
    });
    const reconciled = [...answered, e('reconciled', 'Medicare', 6)];
    assert.equal(step(reconciled, 6).step, 'review');
    assert.equal(step([...reconciled, e('response', 'Medicare', 7, 1_000)], 7).step, 'reconcile');
    assert.equal(step([e('response', 'Medicare', 5, 100_000)], 6).step, 'closed');
  });

  it('spaces patient statements 30 days apart before collections', () => {
    const one = [e('statement', null, 0)];
    assert.deepEqual(step(one, 0, []), {
      step: 'awaitPatient',
      waitMs: 30 * DAY,
      balanceCents: 100_000
    });
    assert.deepEqual(step(one, 30, []), { step: 'statement', statement: 2, balanceCents: 100_000 });
    const three = [e('statement', null, 0), e('statement', null, 30), e('statement', null, 60)];
    assert.equal(step(three, 75, []).step, 'awaitPatient');
    assert.deepEqual(step(three, 90, []), { step: 'collections', balanceCents: 100_000 });
  });

  it('sends no statement when the limit is zero, and honors other limits', () => {
    const ledger = { totalCents: 100_000, coverages: [], events: [e('approved', null, 0)] };
    const policy = { payerWaitMs: 30 * DAY, statementIntervalMs: 30 * DAY };
    assert.deepEqual(nextClaimStep(ledger, day(0), { ...policy, statementLimit: 0 }), {
      step: 'collections',
      balanceCents: 100_000
    });
    const one = { ...ledger, events: [...ledger.events, e('statement', null, 0)] };
    assert.equal(
      nextClaimStep(one, day(10), { ...policy, statementLimit: 1 }).step,
      'awaitPatient'
    );
    assert.equal(nextClaimStep(one, day(30), { ...policy, statementLimit: 1 }).step, 'collections');
  });

  it('submits an approved claim right away, and never before it is approved', () => {
    assert.equal(step([], 0).step, 'review');
    assert.deepEqual(step([e('approved', 'Medicare', 0)], 0), {
      step: 'submit',
      coverage: cov('Medicare'),
      balanceCents: 100_000
    });
  });

  it('sends a rejected claim back to review with the reason, while an acceptance keeps waiting', () => {
    const sent = [e('approved', 'Medicare', 0), e('submitted', 'Medicare', 0)];
    assert.equal(step([...sent, e('accepted', 'Medicare', 1)], 2).step, 'await');
    const rejected = [...sent, { ...e('rejected', 'Medicare', 1), note: 'A7: Invalid member ID' }];
    assert.equal(step(rejected, 2).step, 'review');
    assert.equal(
      claimProgress({ totalCents: 100_000, coverages: [cov('Medicare')], events: rejected })
        .rejection,
      'A7: Invalid member ID'
    );
    assert.equal(step([...rejected, e('approved', 'Medicare', 2)], 2).step, 'submit');
    assert.equal(
      step([...rejected, e('approved', 'Medicare', 2), e('resubmitted', 'Medicare', 3)], 3).step,
      'await'
    );
  });

  it('re-requires review when the claim is edited after approval', () => {
    const approved = [e('approved', 'Medicare', 0)];
    assert.equal(step([...approved, e('edited', null, 1)], 1).step, 'review');
    assert.equal(
      step([...approved, e('edited', null, 1), e('approved', 'Medicare', 1)], 1).step,
      'submit'
    );
  });

  it('confirms the payers of a claim without any, and reviews before the first statement', () => {
    assert.equal(step([], 0, []).step, 'confirmPayers');
    const done = [e('payer_skipped', 'Medicare', 0)];
    assert.equal(step(done, 0, ['Medicare']).step, 'reviewPatient');
    assert.equal(step([...done, e('approved', null, 0)], 0, ['Medicare']).step, 'statement');
    assert.equal(
      step([...done, e('approved', null, 0), e('edited', null, 0)], 0, ['Medicare']).step,
      'reviewPatient'
    );
  });

  it('reopens a payer whose denial is corrected and resubmitted, keeping its claim number', () => {
    const denied = [
      e('approved', 'Medicare', 0),
      e('submitted', 'Medicare', 0),
      { ...e('response', 'Medicare', 5), payerClaimNumber: 'ICN-1' }
    ];
    assert.equal(step(denied, 6).step, 'reconcile');
    const reopened = [...denied, e('resubmit_queued', 'Medicare', 6)];
    assert.deepEqual(step(reopened, 6), {
      step: 'review',
      coverage: cov('Medicare'),
      balanceCents: 100_000
    });
    const progress = claimProgress({
      totalCents: 100_000,
      coverages: [cov('Medicare'), cov('Blue Plan')],
      events: reopened
    });
    assert.equal(progress.payerClaimNumber, 'ICN-1');
    assert.equal(progress.submittedBefore, true);
    assert.deepEqual(progress.priorCoverages, []);
  });

  it('carries the reason codes and paid date of prior payers, and flags an overpayment', () => {
    const paid = {
      ...e('response', 'Medicare', 5, 60_000, 30_000),
      paidOn: '2026-01-03',
      adjustments: [{ group: 'CO' as const, reason: '45', cents: 30_000 }]
    };
    const progress = claimProgress({
      totalCents: 100_000,
      coverages: [cov('Medicare'), cov('Blue Plan')],
      events: [paid]
    });
    assert.deepEqual(progress.priorCoverages[0]?.adjustments, paid.adjustments);
    assert.equal(progress.priorCoverages[0]?.paidOn, '2026-01-03');
    assert.deepEqual(step([e('response', 'Medicare', 1, 110_000)], 1), {
      step: 'overpaid',
      balanceCents: -10_000
    });
    assert.equal(
      step([e('response', 'Medicare', 1, 110_000), e('refunded', 'Medicare', 2, -10_000)], 2).step,
      'closed'
    );
    assert.deepEqual(progress.skipped, []);
  });

  it('closes once the balance is paid, by payers or the patient', () => {
    assert.deepEqual(step([e('response', 'Medicare', 1, 100_000)], 1), {
      step: 'closed',
      balanceCents: 0
    });
    assert.equal(
      step([e('statement', null, 0), e('response', null, 3, 100_000)], 3, []).step,
      'closed'
    );
  });
});

describe('claim statuses', () => {
  it('names the status a biller sees for each step, leaving closing to the close step', () => {
    assert.deepEqual(
      (
        [
          'review',
          'reviewPatient',
          'confirmPayers',
          'submit',
          'await',
          'followUp',
          'reconcile',
          'overpaid',
          'statement',
          'collections'
        ] as const
      ).map(stageOf),
      [
        'needs_review',
        'needs_review',
        'needs_review',
        'ready',
        'submitted',
        'follow_up',
        'reconcile',
        'reconcile',
        'patient_balance',

        'balance_review'
      ]
    );
    assert.equal(stageOf('closed'), null);
    assert.deepEqual(['paid', 'void', 'ready'].map(isClosedStatus), [true, true, false]);
  });
});

describe('claimProgress', () => {
  it('follows the coverage, not its display name, so renaming a payer never re-bills it', () => {
    const renamed = { id: 'cov-Medicare', payer: 'Medicare Part B' };
    const ledger = {
      totalCents: 100_000,
      coverages: [renamed, cov('Blue Plan')],
      events: [e('response', 'Medicare', 1, 40_000)]
    };
    assert.deepEqual(claimProgress(ledger).coverage, cov('Blue Plan'));
    assert.deepEqual(claimProgress(ledger).priorCoverages, [
      { ...renamed, paidCents: 40_000, adjustedCents: 0, paidOn: '2026-01-02', adjustments: [] }
    ]);
  });

  it('totals every response of a prior payer and dates it by the last one', () => {
    const ledger = {
      totalCents: 100_000,
      coverages: [cov('Medicare'), cov('Blue Plan')],
      events: [e('response', 'Medicare', 1, 40_000, 5_000), e('response', 'Medicare', 3, 1_000)]
    };
    assert.deepEqual(claimProgress(ledger).priorCoverages, [
      {
        ...cov('Medicare'),
        paidCents: 41_000,
        adjustedCents: 5_000,
        paidOn: '2026-01-04',
        adjustments: []
      }
    ]);
  });

  it('keeps the payer claim number the current payer last gave', () => {
    const numbered = (n: string | null, onDay: number) => ({
      ...e('follow_up', 'Medicare', onDay),
      payerClaimNumber: n
    });
    const ledger = (events: ClaimEvent[]) => ({
      totalCents: 100_000,
      coverages: [cov('Medicare')],
      events
    });
    assert.equal(claimProgress(ledger([])).payerClaimNumber, null);
    assert.equal(
      claimProgress(ledger([numbered('A1', 1), numbered('B2', 2), numbered(null, 3)]))
        .payerClaimNumber,
      'B2'
    );
  });
});

describe('claim signals', () => {
  it('names the signal every claim change sends to its cycle', () => {
    assert.equal(claimSignalKey('c1'), `${CLAIM_SIGNAL}:c1`);
    assert.equal(CLAIM_SIGNAL, 'claim');
  });
});
