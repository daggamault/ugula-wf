import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ManualPayment, paymentLine, readPayment, readReasonCode } from './claim-payments.ts';
import type { RemittancePosting, RemittanceRoute } from './remittances.ts';

const posting = (route: RemittanceRoute, adjustedCents = 2025): RemittancePosting => ({
  position: 0,
  route,
  message: `routed ${route}`,
  adjustedCents,
  crossover: false
});

const blank: ManualPayment = {
  kind: 'response',
  coverageId: null,
  paidCents: 0,
  adjustedCents: 0,
  route: null,
  paidOn: null,
  checkNumber: null,
  payerClaimNumber: null,
  adjustments: [],
  note: ''
};

describe('readReasonCode', () => {
  it('reads a group, a reason code and a signed dollar amount', () => {
    assert.deepEqual(readReasonCode('CO-45 12.50'), { group: 'CO', reason: '45', cents: 1250 });
    assert.deepEqual(readReasonCode(' pr 2  -3 '), { group: 'PR', reason: '2', cents: -300 });
    assert.deepEqual(readReasonCode('OA45 1.5'), { group: 'OA', reason: '45', cents: 150 });
  });

  it('reads nothing from an unknown group, a zero amount, a long code or a missing amount', () => {
    assert.equal(readReasonCode('XX-45 1'), null);
    assert.equal(readReasonCode('CO-45 0'), null);
    assert.equal(readReasonCode('CO-123456 1'), null);
    assert.equal(readReasonCode('CO-45'), null);
    assert.equal(readReasonCode('CO-45 1.234'), null);
    assert.equal(readReasonCode(''), null);
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
  const read = {
    ...blank,
    coverageId: 'cov-1',
    paidCents: 8000,
    paidOn: '2026-10-05',
    checkNumber: 'CHK-1',
    payerClaimNumber: 'PCN-9',
    adjustments: [{ group: 'CO' as const, reason: '45', cents: 2025 }],
    note: 'by hand'
  };

  it('turns dollars into cents and takes off what Route Remittance says the codes adjust', () => {
    assert.deepEqual(readPayment(entry, posting('reconcile')), {
      ...read,
      adjustedCents: 2025,
      route: 'reconcile'
    });
  });

  it('adjusts nothing and routes nowhere without a posting', () => {
    assert.deepEqual(readPayment(entry), read);
  });

  it('posts on every postable route', () => {
    for (const route of ['denial', 'appeal', 'fix'] as const) {
      assert.deepEqual(readPayment(entry, posting(route, 0)), { ...read, route });
    }
  });

  it('ignores reason codes that are not a list', () => {
    assert.deepEqual(readPayment({ ...entry, reasonCodes: 'CO-45 1' }), {
      ...read,
      adjustments: []
    });
  });

  it('keeps no payer claim number on a patient payment', () => {
    assert.deepEqual(readPayment({ paid: 25, payerClaimNumber: 'PCN-9' }), {
      ...blank,
      paidCents: 2500
    });
  });

  it('keeps a refund off the routing and without a payer claim number', () => {
    assert.deepEqual(
      readPayment(
        { kind: 'refunded', coverageId: 'cov-1', paid: 5, payerClaimNumber: 'PCN-9' },
        posting('fix')
      ),
      { ...blank, kind: 'refunded', coverageId: 'cov-1', paidCents: 500 }
    );
  });

  it('accepts a zero payer payment', () => {
    assert.deepEqual(readPayment({ coverageId: 'cov-1', paid: 0 }), {
      ...blank,
      coverageId: 'cov-1'
    });
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
    assert.equal(cents(undefined), 0);
    assert.equal(cents(1_000_000), 100_000_000);
    assert.equal(cents(1_000_000.01), 'Enter amounts of zero or more');
    for (const paid of ['12.50', Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
      assert.equal(cents(paid), 'Enter amounts of zero or more');
    }
  });

  it('falls back to a routing message when the route gives none', () => {
    assert.equal(
      readPayment(entry, { ...posting('review'), message: '' }),
      'Route Remittance leaves this payment to be posted another way'
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
    assert.equal(
      readPayment({ paid: 1, reasonCodes: ['CO-45 1', ' 45 '] }),
      'Write each reason code as a group, code and amount, like CO-45 12.50 (not "45")'
    );
  });
});

describe('paymentLine', () => {
  const line = {
    position: 0,
    claimId: 'claim-1',
    payerName: null,
    status: '',
    remarks: [],
    crossoverPayer: null,
    denied: false,
    reversal: false,
    reversesPosted: false,
    takeback: false
  };

  it('reads a hand-posted payment as one remittance line with its codes merged', () => {
    const payment: ManualPayment = {
      ...blank,
      coverageId: 'cov-1',
      paidCents: 1000,
      payerClaimNumber: 'PCN-9',
      adjustments: [
        { group: 'CO', reason: '45', cents: 500 },
        { group: 'CO', reason: '45', cents: 250 },
        { group: 'PR', reason: '2', cents: 100 }
      ]
    };
    assert.deepEqual(paymentLine('claim-1', payment), {
      ...line,
      reference: 'PCN-9',
      coverageId: 'cov-1',
      paidCents: 1000,
      adjustments: [
        { group: 'CO', reason: '45', cents: 750 },
        { group: 'PR', reason: '2', cents: 100 }
      ]
    });
  });

  it('leaves the reference blank without a payer claim number', () => {
    assert.deepEqual(paymentLine('claim-1', { ...blank, paidCents: 2500 }), {
      ...line,
      reference: '',
      coverageId: null,
      paidCents: 2500,
      adjustments: []
    });
  });
});
