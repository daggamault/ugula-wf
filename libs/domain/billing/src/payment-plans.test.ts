import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimEvent } from './claims.ts';
import {
  addDays,
  billingStatements,
  isEndedPlanStatus,
  type LedgerPlan,
  planProgress
} from './payment-plans.ts';

const DAY = 86_400_000;

const at = (on: string) => `${on}T12:00:00.000Z`;

const e = (kind: ClaimEvent['kind'], on: string, paid = 0, coverageId: string | null = null) =>
  ({
    kind,
    coverageId,
    paidCents: paid,
    adjustedCents: 0,
    payerClaimNumber: null,
    paidOn: null,
    adjustments: [],
    note: '',
    at: at(on)
  }) satisfies ClaimEvent;

const plan: LedgerPlan = {
  installmentCents: 5_000,
  intervalDays: 30,
  firstDueOn: '2026-12-01',
  missedCount: 0,
  startedAt: at('2026-11-17'),
  timeZone: 'UTC'
};

describe('addDays', () => {
  it('counts calendar days across months', () => {
    assert.equal(addDays('2026-12-01', 30), '2026-12-31');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });
});

describe('isEndedPlanStatus', () => {
  it('knows the statuses a plan ends with', () => {
    assert.deepEqual(
      ['completed', 'defaulted', 'cancelled', 'active', 'x'].map(isEndedPlanStatus),
      [true, true, true, false, false]
    );
  });
});

describe('planProgress', () => {
  it('ends the due day at midnight in the agency time zone', () => {
    const now = new Date('2026-12-01T12:00:00Z');
    assert.equal(
      planProgress({ ...plan, timeZone: 'America/New_York' }, [], now).untilDueMs,
      Date.parse('2026-12-02T05:00:00Z') - now.getTime()
    );
  });

  const now = new Date(at('2026-11-20'));

  it('starts with the first installment, due at the end of its day and not billed yet', () => {
    assert.deepEqual(planProgress(plan, [e('plan_started', '2026-11-17')], now), {
      dueOn: '2026-12-01',
      untilDueMs: Date.parse('2026-12-02T00:00:00Z') - now.getTime(),
      paidCents: 0,
      billed: false
    });
  });

  it('moves to the next installment once the patient pays one, counting partial payments', () => {
    const events = [
      e('plan_started', '2026-11-17'),
      e('statement', '2026-11-17'),
      e('response', '2026-11-25', 6_000),
      e('response', '2026-11-26', 9_000, 'cov-1')
    ];
    const p = planProgress(plan, events, now);
    assert.deepEqual([p.dueOn, p.paidCents, p.billed], ['2026-12-31', 1_000, false]);
    const billed = planProgress(plan, [...events, e('statement', '2026-11-27')], now);
    assert.equal(billed.billed, true);
  });

  it('moves on after a missed installment is kept, and ignores what came before the plan', () => {
    const events = [
      e('response', '2026-11-01', 5_000),
      e('plan_started', '2026-11-17'),
      e('statement', '2026-11-17'),
      e('plan_missed', '2026-12-12')
    ];
    const p = planProgress(plan, events, new Date(at('2026-12-12')));
    assert.deepEqual([p.dueOn, p.paidCents, p.billed], ['2026-12-31', 0, false]);
    assert.equal(
      planProgress(plan, events.slice(0, 3), new Date(at('2026-12-12'))).untilDueMs,
      -10.5 * DAY
    );
  });
});

describe('billingStatements', () => {
  it('leaves out statements sent while a payment plan was active', () => {
    const events = [
      e('statement', '2026-10-01'),
      e('plan_started', '2026-10-15'),
      e('statement', '2026-10-16'),
      e('plan_ended', '2026-11-15'),
      e('statement', '2026-11-16')
    ];
    assert.deepEqual(
      billingStatements(events).map((s) => s.at),
      [at('2026-10-01'), at('2026-11-16')]
    );
  });
});
