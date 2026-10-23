import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type ClaimEvent,
  claimProgress,
  MIN_WAIT_MS,
  nextClaimStep,
  RECHECK_MS
} from './claims.ts';

const DAY = 86_400_000;
const start = Date.parse('2026-01-01T00:00:00.000Z');
const day = (n: number) => new Date(start + n * DAY);

const e = (
  kind: ClaimEvent['kind'],
  payer: string | null,
  onDay: number,
  paid = 0,
  adjusted = 0
): ClaimEvent => ({
  kind,
  payer,
  paidCents: paid,
  adjustedCents: adjusted,
  at: day(onDay).toISOString()
});

const step = (events: ClaimEvent[], onDay: number, payers = ['Medicare', 'Blue Plan']) =>
  nextClaimStep({ totalCents: 100_000, payers, events }, day(onDay));

describe('nextClaimStep', () => {
  it('submits to the first payer that has not answered, then waits at most a day at a time', () => {
    assert.deepEqual(step([], 0), {
      step: 'submit',
      payer: 'Medicare',
      waitMs: RECHECK_MS,
      balanceCents: 100_000
    });
    assert.deepEqual(step([e('submitted', 'Medicare', 0)], 0), {
      step: 'await',
      payer: 'Medicare',
      waitMs: RECHECK_MS,
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
      payer: 'Medicare',
      balanceCents: 100_000
    });
    assert.equal(step([...sent, e('follow_up', 'Medicare', 30)], 31).step, 'await');
    assert.equal(step([...sent, e('resubmitted', 'Medicare', 30)], 59).step, 'await');
  });

  it('puts a claim back in line for the next batch when a resubmission is queued', () => {
    const queued = [e('submitted', 'Medicare', 0), e('resubmit_queued', 'Medicare', 30)];
    assert.equal(step(queued, 31).step, 'submit');
    assert.equal(
      claimProgress({ totalCents: 1, payers: ['Medicare'], events: queued }).submittedBefore,
      true
    );
    assert.equal(step([...queued, e('resubmitted', 'Medicare', 32)], 33).step, 'await');
  });

  it('lists the payers that already answered ahead of the one being billed', () => {
    const ledger = {
      totalCents: 100_000,
      payers: ['Medicare', 'Blue Plan', 'Aetna'],
      events: [e('response', 'Medicare', 1, 50_000), e('payer_skipped', 'Blue Plan', 2)]
    };
    assert.deepEqual(claimProgress(ledger).priorPayers, ['Medicare']);
    assert.equal(claimProgress(ledger).payer, 'Aetna');
    assert.equal(claimProgress(ledger).submittedBefore, false);
  });

  it('tracks payers by name, so reordering, out-of-order responses and skips never re-bill', () => {
    const both = [
      e('submitted', 'Medicare', 0),
      e('response', 'Medicare', 5, 50_000),
      e('submitted', 'Blue Plan', 5),
      e('response', 'Blue Plan', 9, 10_000)
    ];
    assert.equal(step(both, 10, ['Blue Plan', 'Medicare']).step, 'statement');
    assert.deepEqual(step([e('response', 'Blue Plan', 1, 5_000)], 2), {
      step: 'submit',
      payer: 'Medicare',
      waitMs: RECHECK_MS,
      balanceCents: 95_000
    });
    assert.equal(
      step([e('response', 'Blue Plan', 1), e('response', 'Medicare', 2)], 3).step,
      'statement'
    );
    assert.deepEqual(step([e('payer_skipped', 'Medicare', 1)], 1), {
      step: 'submit',
      payer: 'Blue Plan',
      waitMs: RECHECK_MS,
      balanceCents: 100_000
    });
  });

  it('spaces patient statements 30 days apart before collections', () => {
    const one = [e('statement', null, 0)];
    assert.deepEqual(step(one, 0, []), {
      step: 'awaitPatient',
      waitMs: RECHECK_MS,
      balanceCents: 100_000
    });
    assert.deepEqual(step(one, 30, []), { step: 'statement', statement: 2, balanceCents: 100_000 });
    const three = [e('statement', null, 0), e('statement', null, 30), e('statement', null, 60)];
    assert.equal(step(three, 75, []).step, 'awaitPatient');
    assert.deepEqual(step(three, 90, []), { step: 'collections', balanceCents: 100_000 });
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
