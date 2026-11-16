import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paymentLine, readPayment, readReasonCode } from './claim-payments.ts';
import type { RemittancePosting, RemittanceRoute } from './remittances.ts';

const posting = (route: RemittanceRoute, adjustedCents = 2025): RemittancePosting => ({
  position: 0,
  route,
  message: `routed ${route}`,
  adjustedCents,
  crossover: false
});

describe('readReasonCode', () => {
  it('reads a group, a reason code and a signed dollar amount', () => {
    assert.deepEqual(readReasonCode('CO-45 12.50'), { group: 'CO', reason: '45', cents: 1250 });
    assert.deepEqual(readReasonCode(' pr 2  -3 '), { group: 'PR', reason: '2', cents: -300 });
    assert.equal(readReasonCode('XX-45 1'), null);
    assert.equal(readReasonCode('CO-45 0'), null);
    assert.equal(readReasonCode('CO-123456 1'), null);
    assert.equal(readReasonCode('CO-45'), null);
  });
});

describe('readPayment', () => {
  const entry = {
    coverageId: 'cov-1',
    paid: 80,
    paidOn: '2026-10-05',
    checkNumber: ' CHK-1 ',
    payerClaimNumber: 'PCN-9',
    reasonCodes: ['CO-45 20.25', ' '],
    note: 'by hand'
  };

  it('turns dollars into cents and takes off what Route Remittance says the codes adjust', () => {
    assert.deepEqual(readPayment(entry, posting('reconcile')), {
      kind: 'response',
      coverageId: 'cov-1',
      paidCents: 8000,
      adjustedCents: 2025,
      route: 'reconcile',
      paidOn: '2026-10-05',
      checkNumber: 'CHK-1',
      payerClaimNumber: 'PCN-9',
      adjustments: [{ group: 'CO', reason: '45', cents: 2025 }],
      note: 'by hand'
    });
    const unrouted = readPayment(entry);
    assert.ok(typeof unrouted === 'object');
    assert.equal(unrouted.adjustedCents, 0);
    assert.equal(unrouted.route, null);
  });

  it('keeps a patient payment and a refund to what each can carry', () => {
    const patient = readPayment({ paid: 25, payerClaimNumber: 'PCN-9' });
    assert.ok(typeof patient === 'object');
    assert.equal(patient.coverageId, null);
    assert.equal(patient.payerClaimNumber, null);
    const refund = readPayment({ kind: 'refunded', coverageId: 'cov-1', paid: 5 }, posting('fix'));
    assert.ok(typeof refund === 'object');
    assert.equal(refund.adjustedCents, 0);
    assert.equal(refund.route, null);
    assert.equal(refund.kind, 'refunded');
  });

  it('refuses what the routing leaves to be posted another way', () => {
    assert.equal(readPayment(entry, posting('review')), 'routed review');
    assert.equal(
      readPayment(entry, posting('reconcile', -1)),
      'The adjustments that lower the balance add up to less than zero'
    );
  });

  it('rounds dollars to the nearest cent and caps a payment at one million dollars', () => {
    const cents = (paid: unknown) => {
      const payment = readPayment({ coverageId: 'cov-1', paid });
      return typeof payment === 'object' ? payment.paidCents : payment;
    };
    assert.equal(cents(0.1 + 0.2), 30);
    assert.equal(cents(12.345), 1235);
    assert.equal(cents(0), 0);
    assert.equal(cents(null), 0);
    assert.equal(cents(1_000_000), 100_000_000);
    assert.equal(cents(1_000_000.01), 'Enter amounts of zero or more');
    for (const paid of ['12.50', Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
      assert.equal(cents(paid), 'Enter amounts of zero or more');
    }
  });

  it('falls back to a routing message when the route gives none', () => {
    assert.equal(
      readPayment(entry, { ...posting('review'), message: '' }),
      'Remittance Routing leaves this payment to be posted another way'
    );
  });

  it('says what is wrong with an entry it cannot post', () => {
    assert.equal(readPayment({}), 'A patient payment needs an amount');
    assert.equal(
      readPayment({ kind: 'refunded', coverageId: 'c' }),
      'A refund needs the amount paid back'
    );
    assert.equal(readPayment({ paid: -1 }), 'Enter amounts of zero or more');
    assert.equal(readPayment({ kind: 'gift', paid: 1 }), 'Unknown payment type "gift"');
    assert.equal(
      readPayment({ kind: 'refunded', coverageId: 'c', paid: 1, reasonCodes: ['CO-45 1'] }),
      'A refund carries no reason codes'
    );
    assert.match(
      String(readPayment({ paid: 1, reasonCodes: ['45'] })),
      /like CO-45 12\.50 \(not "45"\)/
    );
  });
});

describe('paymentLine', () => {
  it('reads a hand-posted payment as one remittance line for Route Remittance', () => {
    const payment = readPayment({
      coverageId: 'cov-1',
      paid: 10,
      payerClaimNumber: 'PCN-9',
      reasonCodes: ['CO-45 5', 'co-45 2.5', 'PR-2 1']
    });
    assert.ok(typeof payment === 'object');
    assert.deepEqual(paymentLine('claim-1', payment), {
      position: 0,
      reference: 'PCN-9',
      claimId: 'claim-1',
      coverageId: 'cov-1',
      payerName: null,
      status: '',
      remarks: [],
      crossoverPayer: null,
      denied: false,
      reversal: false,
      reversesPosted: false,
      takeback: false,
      paidCents: 1000,
      adjustments: [
        { group: 'CO', reason: '45', cents: 750 },
        { group: 'PR', reason: '2', cents: 100 }
      ]
    });
  });
});
