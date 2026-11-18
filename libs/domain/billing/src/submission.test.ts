import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ClaimSubmission, isSelfPay, submissionIssues, x837ClaimOf } from './submission.ts';
import { sampleEnvelope, sampleSubmitter } from './testing.ts';
import { build837, readX837Claim } from './x837.ts';

const PLACE = { line: '1 Elm St', city: 'Dayton', state: 'OH', postalCode: '45402' };

const READY: ClaimSubmission = {
  number: '20261001-0012',
  serviceDate: '2026-10-01',
  loadedMiles: 7.4,
  transportReason: 'A',
  conditionCodes: ['06'],
  weightPounds: 180,
  patient: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    birthDate: '1950-12-10',
    sex: 'F',
    addressLine: '1 Elm St',
    city: 'Dayton',
    state: 'OH',
    postalCode: '45402'
  },
  pickup: { name: null, ...PLACE },
  destination: { name: 'Miami Valley Hospital', ...PLACE, line: '1 Wyoming St' },
  priorAuthorization: 'PA-1',
  signatureOnFile: true,
  note: 'Chest pain',
  diagnoses: ['R079'],
  coverages: [
    {
      payerName: 'Medicare',
      payer: { name: 'Medicare Part B', payerCode: 'DEMOMCR', claimFiling: 'MB' },
      memberId: '1EG4TE5MK73',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    },
    {
      payerName: 'Unknown Plan',
      payer: null,
      memberId: null,
      groupId: null,
      relationship: '01',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  lines: [
    { code: 'A0427', modifiers: ['RH'], units: 1, totalCents: 85_000 },
    { code: 'A0425', modifiers: ['RH'], units: 7.4, totalCents: 9_250 }
  ]
};

const EMPTY_PLACE = { name: null, line: null, city: null, state: null, postalCode: null };

describe('submissionIssues', () => {
  it('finds nothing missing on a claim the 837P can carry, whatever its later payers lack', () => {
    assert.deepEqual(submissionIssues(READY, sampleSubmitter), []);
  });

  it('names everything the 837P needs and the claim lacks', () => {
    const [primary] = READY.coverages;
    assert.ok(primary);
    assert.deepEqual(
      submissionIssues(
        {
          ...READY,
          serviceDate: null,
          transportReason: null,
          diagnoses: [],
          patient: { ...READY.patient, addressLine: null, postalCode: null },
          pickup: { ...READY.pickup, city: null },
          destination: EMPTY_PLACE,
          coverages: [
            { ...primary, payer: null, memberId: null, relationship: '19', insuredLastName: null }
          ],
          lines: [{ code: 'A0427', modifiers: [], units: 1, totalCents: 0 }]
        },
        null
      ),
      [
        'Add a billing profile in Settings',
        'The claim has no date of service',
        'The claim has no diagnosis',
        'Line 1 (A0427) has no price: add a fee for it, then edit the claim',
        'The first payer, Medicare, is not in the payer directory: add it there, or choose a directory payer on the claim',
        'The first payer, Medicare, has no member ID',
        'The first payer, Medicare, has no insured name, and the patient is not the insured',
        'The patient address has no street or ZIP code',
        'The pickup location has no city',
        'The destination has no street, city, state or ZIP code',
        'A transport needs a transport reason (CR1)'
      ]
    );
  });

  it('needs no destination or transport reason without loaded miles', () => {
    assert.deepEqual(
      submissionIssues(
        { ...READY, loadedMiles: 0, transportReason: null, destination: EMPTY_PLACE },
        sampleSubmitter
      ),
      []
    );
  });

  it('needs only a mailing address for a claim the patient pays', () => {
    const selfPay = { ...READY, coverages: [], lines: [], diagnoses: [] };
    assert.ok(isSelfPay(selfPay));
    assert.ok(!isSelfPay(READY));
    assert.deepEqual(submissionIssues(selfPay, null), []);
    assert.deepEqual(
      submissionIssues({ ...selfPay, patient: { ...READY.patient, city: null } }, null),
      ['The patient address has no city']
    );
  });
});

describe('x837ClaimOf', () => {
  it('bills the first payer on a ground claim the 837P builder accepts', () => {
    const claim = x837ClaimOf(READY);
    assert.deepEqual(readX837Claim(claim), claim);
    assert.deepEqual(
      [claim.claimId, claim.placeOfService, claim.frequency, claim.benefitsAssignment],
      ['20261001-0012', '41', '1', 'Y']
    );
    assert.deepEqual(claim.payer, {
      name: 'Medicare Part B',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      insuranceType: null
    });
    assert.deepEqual(claim.subscriber, {
      relationship: '18',
      lastName: 'Lovelace',
      firstName: 'Ada',
      memberId: '1EG4TE5MK73',
      groupId: null
    });
    assert.deepEqual(claim.dropoff, {
      name: 'Miami Valley Hospital',
      addressLine: '1 Wyoming St',
      city: 'Dayton',
      state: 'OH',
      postalCode: '45402'
    });
    assert.deepEqual(
      claim.lines.map((l) => [l.code, l.chargeCents, l.units, l.serviceDate]),
      [
        ['A0427', 85_000, 1, '2026-10-01'],
        ['A0425', 9_250, 7.4, '2026-10-01']
      ]
    );
    const x12 = build837(sampleSubmitter, [claim], sampleEnvelope);
    assert.match(x12, /CLM\*20261001-0012\*942.5\*\*\*41:B:1\*Y\*A\*Y\*Y/);
    assert.match(x12, /REF\*G1\*PA-1/);
    assert.match(x12, /NTE\*ADD\*CHEST PAIN~/);
  });

  it('bills the insured named on the policy, the air place of service and no assignment unsigned', () => {
    const [primary] = READY.coverages;
    assert.ok(primary);
    const claim = x837ClaimOf({
      ...READY,
      signatureOnFile: false,
      coverages: [
        { ...primary, relationship: '01', insuredFirstName: 'Bob', insuredLastName: 'Lovelace' }
      ],
      lines: [{ code: 'A0431', modifiers: ['RH'], units: 1, totalCents: 500_000 }]
    });
    assert.deepEqual(
      [claim.placeOfService, claim.benefitsAssignment, claim.subscriber.firstName],
      ['42', 'N', 'Bob']
    );
  });

  it('refuses a claim not ready to send', () => {
    assert.throws(() => x837ClaimOf({ ...READY, coverages: [] }), /not ready to send/);
  });
});
