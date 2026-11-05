import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readPayment, readReasonCode } from './claim-payments.ts';

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
  it('turns dollars into cents and reason code lines into adjustments', () => {
    assert.deepEqual(
      readPayment({
        coverageId: 'cov-1',
        paid: 80,
        adjusted: 20.25,
        paidOn: '2026-10-05',
        checkNumber: ' CHK-1 ',
        payerClaimNumber: 'PCN-9',
        reasonCodes: ['CO-45 20.25', ' '],
        note: 'by hand'
      }),
      {
        kind: 'response',
        coverageId: 'cov-1',
        paidCents: 8000,
        adjustedCents: 2025,
        paidOn: '2026-10-05',
        checkNumber: 'CHK-1',
        payerClaimNumber: 'PCN-9',
        adjustments: [{ group: 'CO', reason: '45', cents: 2025 }],
        note: 'by hand'
      }
    );
  });

  it('keeps a patient payment and a refund to what each can carry', () => {
    const patient = readPayment({ paid: 25, payerClaimNumber: 'PCN-9' });
    assert.ok(typeof patient === 'object');
    assert.equal(patient.coverageId, null);
    assert.equal(patient.payerClaimNumber, null);
    const refund = readPayment({ kind: 'refunded', coverageId: 'cov-1', paid: 5, adjusted: 9 });
    assert.ok(typeof refund === 'object');
    assert.equal(refund.adjustedCents, 0);
    assert.equal(refund.kind, 'refunded');
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
