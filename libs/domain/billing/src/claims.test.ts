import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_STEPS,
  type ClaimEvent,
  claimProgress,
  claimSignalKey,
  isClaimStep,
  isClosedStatus,
  ledgerFactsOf,
  MIN_WAIT_MS,
  readClaimStep,
  STEP_STATUSES
} from './claims.ts';

const DAY = 86_400_000;
const start = Date.parse('2026-01-01T00:00:00.000Z');
const day = (n: number) => new Date(start + n * DAY);

const cov = (payer: string) => ({ id: `cov-${payer}`, payer, claimFiling: 'MB' });

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

const facts = (events: ClaimEvent[], onDay: number, payers = ['Medicare', 'Blue Plan']) =>
  ledgerFactsOf({ totalCents: 100_000, coverages: payers.map(cov), events }, day(onDay));

describe('ledgerFactsOf', () => {
  it('states where a new claim stands: the first payer, not yet approved or contacted', () => {
    assert.deepEqual(facts([], 0), {
      balanceCents: 100_000,
      coverageId: 'cov-Medicare',
      payer: 'Medicare',
      payerKind: 'MB',
      coverageCount: 2,
      contacted: false,
      sinceContactMs: null,
      approved: false,
      unreconciledCoverageId: null,
      unreconciledPayer: null,
      denialRoute: null,
      appeals: 0,
      billFacility: false,
      patientApproved: false,
      statements: 0,
      sinceStatementMs: null,
      rejection: null
    });
  });

  it('measures the time since the payer was contacted and the last statement', () => {
    const sent = facts([e('approved', 'Medicare', 0), e('submitted', 'Medicare', 1)], 11);
    assert.deepEqual([sent.approved, sent.contacted, sent.sinceContactMs], [false, true, 10 * DAY]);
    const answered = facts(
      [e('submitted', 'Medicare', 1), e('response', 'Medicare', 5, 20_000)],
      6
    );
    assert.deepEqual(
      [answered.coverageId, answered.unreconciledCoverageId, answered.unreconciledPayer],
      ['cov-Blue Plan', 'cov-Medicare', 'Medicare']
    );
    const patient = facts([e('statement', null, 2)], 32, []);
    assert.deepEqual(
      [patient.payerKind, patient.coverageId, patient.statements, patient.sinceStatementMs],
      ['patient', null, 1, 30 * DAY]
    );
  });

  it('opens a denial routed on the response until a biller settles it, counting appeals', () => {
    const denied = (route: 'denial' | 'appeal' | 'fix', onDay: number) => ({
      ...e('denied', 'Medicare', onDay),
      route,
      note: 'Denied'
    });
    const base = [e('submitted', 'Medicare', 1), e('response', 'Medicare', 5), denied('appeal', 5)];
    const open = facts([...base, e('appealed', 'Medicare', 6)], 7);
    assert.deepEqual([open.denialRoute, open.appeals], ['appeal', 1]);
    assert.equal(facts([...base, e('reconciled', 'Medicare', 6)], 7).denialRoute, null);
    const paid = facts([...base, e('response', 'Medicare', 9, 100)], 10);
    assert.equal(paid.denialRoute, null);
    const reopened = facts([...base, e('reopening_requested', 'Medicare', 6)], 7);
    assert.deepEqual(
      [reopened.denialRoute, reopened.coverageId, reopened.contacted],
      [null, 'cov-Medicare', true]
    );
  });

  it('bills a facility instead of payers when one is responsible', () => {
    const ledger = { totalCents: 1, coverages: [], events: [], facilityId: 'f1' };
    assert.equal(ledgerFactsOf(ledger, day(0)).billFacility, true);
  });

  it('says why the last submission was rejected', () => {
    const rejected = facts(
      [e('submitted', 'Medicare', 1), { ...e('rejected', 'Medicare', 2), note: 'Bad ID' }],
      3
    );
    assert.deepEqual([rejected.contacted, rejected.rejection], [false, 'Bad ID']);
  });
});

describe('readClaimStep', () => {
  const ledger = facts([], 0);

  it('shapes a Next Claim Step decision with the payer it is about', () => {
    assert.deepEqual(readClaimStep({ step: 'review' }, ledger), {
      step: 'review',
      coverage: { id: 'cov-Medicare', payer: 'Medicare', claimFiling: 'MB' },
      balanceCents: 100_000
    });
    assert.deepEqual(readClaimStep({ step: 'await', waitMs: 5 * DAY }, ledger), {
      step: 'await',
      coverage: { id: 'cov-Medicare', payer: 'Medicare', claimFiling: 'MB' },
      waitMs: 5 * DAY,
      balanceCents: 100_000
    });
    assert.deepEqual(readClaimStep({ step: 'statement', statementNumber: 2 }, ledger), {
      step: 'statement',
      statement: 2,
      balanceCents: 100_000
    });
    assert.deepEqual(readClaimStep({ step: 'awaitPatient', waitMs: null }, ledger), {
      step: 'awaitPatient',
      waitMs: MIN_WAIT_MS,
      balanceCents: 100_000
    });
    assert.deepEqual(readClaimStep({ step: 'writeOff' }, ledger), {
      step: 'writeOff',
      balanceCents: 100_000
    });
  });

  it('reconciles the payer whose response waits, and refuses unknown or payerless steps', () => {
    const answered = facts([e('submitted', 'Medicare', 1), e('response', 'Medicare', 2, 1)], 3);
    assert.deepEqual(readClaimStep({ step: 'workDenial' }, answered), {
      step: 'workDenial',
      coverage: { id: 'cov-Medicare', payer: 'Medicare', claimFiling: null },
      balanceCents: 99_999
    });
    assert.deepEqual(readClaimStep({ step: 'reconcile' }, answered), {
      step: 'reconcile',
      coverage: { id: 'cov-Medicare', payer: 'Medicare', claimFiling: null },
      balanceCents: 99_999
    });
    assert.throws(() => readClaimStep({ step: 'appeal' }, ledger), /Unknown claim step/);
    assert.throws(() => readClaimStep({ step: 'submit' }, facts([], 0, [])), /needs a payer/);
  });
});

describe('claim statuses', () => {
  it('names the status a biller sees for each step, leaving closing to the close steps', () => {
    assert.deepEqual(
      CLAIM_STEPS.map((s) => STEP_STATUSES[s] ?? null),
      [
        'needs_review',
        'needs_review',
        'needs_review',
        'ready',
        'reconcile',
        'denied',
        'reconcile',
        'submitted',
        'follow_up',
        'patient_balance',
        'patient_balance',
        'facility_billing',
        'balance_review',
        null,
        null
      ]
    );
    assert.ok(isClaimStep('followUp') && !isClaimStep('appeal'));
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
    assert.equal(claimSignalKey('c1'), 'claim:c1');
  });
});
