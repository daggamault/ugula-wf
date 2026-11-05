import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ResponseDraft, toResponse } from './claim-response.tsx';

const draft = (patch: Partial<ResponseDraft> = {}): ResponseDraft => ({
  kind: 'response',
  coverageId: 'cov-m',
  paid: '',
  adjusted: '',
  paidOn: '',
  checkNumber: '',
  payerClaimNumber: '',
  adjustments: [],
  note: '',
  ...patch
});

describe('toResponse', () => {
  it('converts dollars to cents and treats a blank payer as the patient', () => {
    assert.deepEqual(
      toResponse(
        draft({
          paid: '600',
          adjusted: '100.5',
          paidOn: '2026-10-20',
          checkNumber: ' EFT-9 ',
          payerClaimNumber: 'ICN1',
          adjustments: [
            { id: 'a', group: 'CO', reason: ' 45 ', amount: '100.50' },
            { id: 'b', group: 'CR', reason: 'b7', amount: '-5' }
          ],
          note: ' ok '
        })
      ),
      {
        kind: 'response',
        coverageId: 'cov-m',
        paidCents: 60_000,
        adjustedCents: 10_050,
        paidOn: '2026-10-20',
        checkNumber: 'EFT-9',
        payerClaimNumber: 'ICN1',
        adjustments: [
          { group: 'CO', reason: '45', cents: 10_050 },
          { group: 'CR', reason: 'B7', cents: -500 }
        ],
        note: 'ok'
      }
    );
    assert.equal(toResponse(draft({ coverageId: '' })), 'A patient payment needs an amount');
    assert.equal(toResponse(draft({ paid: '-1' })), 'Enter amounts of zero or more');
    assert.equal(toResponse(draft({ adjusted: 'x' })), 'Enter amounts of zero or more');
    const patient = toResponse(draft({ coverageId: '', paid: '20', payerClaimNumber: 'ICN1' }));
    assert.deepEqual(
      typeof patient === 'string'
        ? patient
        : [patient.coverageId, patient.paidCents, patient.payerClaimNumber],
      [null, 2_000, null]
    );
    const zero = toResponse(draft());
    assert.deepEqual(
      typeof zero === 'string'
        ? zero
        : [zero.paidCents, zero.adjustedCents, zero.paidOn, zero.checkNumber],
      [0, 0, null, null]
    );
    assert.match(
      String(
        toResponse(draft({ adjustments: [{ id: 'a', group: 'CO', reason: '45', amount: '0' }] }))
      ),
      /Each reason code/
    );
    assert.match(
      String(
        toResponse(draft({ adjustments: [{ id: 'a', group: 'CO', reason: '', amount: '1' }] }))
      ),
      /Each reason code/
    );
  });

  it('records refunds without adjustments or a payer claim number', () => {
    const refund = toResponse(
      draft({
        kind: 'refunded',
        paid: '25',
        adjusted: '9',
        payerClaimNumber: 'ICN1',
        adjustments: [{ id: 'a', group: 'CO', reason: '45', amount: '1' }]
      })
    );
    assert.deepEqual(
      typeof refund === 'string'
        ? refund
        : [refund.paidCents, refund.adjustedCents, refund.adjustments, refund.payerClaimNumber],
      [2_500, 0, [], null]
    );
    assert.equal(toResponse(draft({ kind: 'refunded' })), 'A refund needs the amount paid back');
  });
});
