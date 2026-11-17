import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_EVENT_KINDS } from './claims.ts';
import { billingEvents, CLAIM_LEDGER_EVENTS, ledgerPayloadColumns } from './events.ts';

describe('billingEvents', () => {
  it('names the events agencies can start workflows on', () => {
    assert.deepEqual(
      billingEvents.map((e) => e.type),
      [
        'import.received',
        'payer_file.received',
        'clearinghouse.failed',
        'clearinghouse.recovered',
        'remittance.file_applied',
        'deposit.recorded',
        'period.closed',
        'claim.opened',
        'claim.submitted',
        'claim.accepted',
        'claim.rejected',
        'claim.denied',
        'claim.appealed',
        'remittance.posted',
        'eligibility.answered',
        'document.received',
        'claim.closed',
        'claim.reopened',
        'payment_plan.started',
        'payment_plan.missed',
        'payment_plan.ended',
        'collections.placed',
        'claim.classified',
        'claim.status_changed',
        'claim.paid',
        'task.completed'
      ]
    );
  });
});

describe('CLAIM_LEDGER_EVENTS', () => {
  it('maps claim history kinds onto events, leaving the rest quiet', () => {
    assert.ok(
      Object.keys(CLAIM_LEDGER_EVENTS).every((k) => CLAIM_EVENT_KINDS.includes(k as never))
    );
    assert.equal(CLAIM_LEDGER_EVENTS.resubmitted, 'claim.submitted');
    assert.equal(CLAIM_LEDGER_EVENTS.response, 'remittance.posted');
    assert.equal(CLAIM_LEDGER_EVENTS.reopened, 'claim.reopened');
    assert.equal(CLAIM_LEDGER_EVENTS.plan_missed, 'payment_plan.missed');
    assert.equal(CLAIM_LEDGER_EVENTS.collections_placed, 'collections.placed');
    assert.ok(!Object.hasOwn(CLAIM_LEDGER_EVENTS, 'credit_transferred'));
    assert.ok(!Object.hasOwn(CLAIM_LEDGER_EVENTS, 'edited'));
  });
});

describe('ledgerPayloadColumns', () => {
  it('reads each payload field of a ledger event from its claim history column', () => {
    assert.deepEqual(ledgerPayloadColumns('remittance.posted'), {
      claimId: 'claim_id',
      coverageId: 'coverage_id',
      paidCents: 'paid_cents',
      adjustedCents: 'adjusted_cents',
      note: 'note'
    });
    assert.deepEqual(ledgerPayloadColumns('claim.denied'), {
      claimId: 'claim_id',
      coverageId: 'coverage_id',
      route: 'route',
      note: 'note'
    });
    assert.deepEqual(ledgerPayloadColumns('claim.reopened'), { claimId: 'claim_id', note: 'note' });
    assert.deepEqual(ledgerPayloadColumns('claim.paid'), {});
  });
});
