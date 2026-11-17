import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build270, type EligibilityRequest } from './x270.ts';
import type { Submitter } from './x837.ts';

const submitter: Submitter = {
  organizationName: 'Metro EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '1 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postalCode: '627011234',
  phone: '2175550100',
  submitterId: 'METROEMS',
  receiverId: 'CLEARING',
  receiverName: 'Clearing House',
  production: true
};

const request: EligibilityRequest = {
  trace: 'cov-1',
  payer: { name: 'Medicare Part B', payerId: 'DEMOMCR' },
  subscriber: {
    lastName: 'Doe',
    firstName: 'Jane',
    memberId: '1EG4TE5MK73',
    birthDate: '1950-02-03',
    sex: 'F'
  },
  serviceDate: '2026-10-01'
};

const envelope = { controlNumber: 42, createdAt: new Date('2026-10-23T14:05:09Z') };

const ISA = (indicator: 'P' | 'T') =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*METROEMS       *ZZ*CLEARING       *261023*1405*^*00501*000000042*0*${indicator}*:~`;

const linesOf = (text: string) => text.trim().split('\n');

const subscriberLines = (r: EligibilityRequest, s: Submitter = submitter) =>
  linesOf(build270(s, [r], envelope)).slice(9, -3);

describe('build270', () => {
  it('asks about health plan coverage for each subscriber on the date of service', () => {
    const text = build270(
      submitter,
      [
        request,
        {
          ...request,
          trace: 'cov-2',
          payer: { name: 'Blue Plan', payerId: 'BCBS1' },
          subscriber: { ...request.subscriber, memberId: 'XYZ' }
        }
      ],
      envelope
    );
    assert.equal(
      text,
      `${[
        ISA('P'),
        'GS*HS*METROEMS*CLEARING*20261023*1405*42*X*005010X279A1~',
        'ST*270*0001*005010X279A1~',
        'BHT*0022*13*000000042*20261023*1405~',
        'HL*1**20*1~',
        'NM1*PR*2*MEDICARE PART B*****PI*DEMOMCR~',
        'HL*2*1*21*1~',
        'NM1*1P*2*METRO EMS*****XX*1234567893~',
        'HL*3*2*22*0~',
        'TRN*1*cov-1*1123456789~',
        'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~',
        'DMG*D8*19500203*F~',
        'DTP*291*D8*20261001~',
        'EQ*30~',
        'HL*4**20*1~',
        'NM1*PR*2*BLUE PLAN*****PI*BCBS1~',
        'HL*5*4*21*1~',
        'NM1*1P*2*METRO EMS*****XX*1234567893~',
        'HL*6*5*22*0~',
        'TRN*1*cov-2*1123456789~',
        'NM1*IL*1*DOE*JANE****MI*XYZ~',
        'DMG*D8*19500203*F~',
        'DTP*291*D8*20261001~',
        'EQ*30~',
        'SE*23*0001~',
        'GE*1*42~',
        'IEA*1*000000042~'
      ].join('\n')}\n`
    );
  });

  it('marks a test interchange when the submitter is not in production', () => {
    assert.equal(
      linesOf(build270({ ...submitter, production: false }, [request], envelope))[0],
      ISA('T')
    );
  });

  it('leaves out demographics when the birth date is unknown', () => {
    assert.deepEqual(
      subscriberLines({ ...request, subscriber: { ...request.subscriber, birthDate: null } }),
      [
        'TRN*1*cov-1*1123456789~',
        'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~',
        'DTP*291*D8*20261001~',
        'EQ*30~'
      ]
    );
  });

  it('sends a missing or unknown sex as U', () => {
    for (const sex of [null, 'X']) {
      assert.equal(
        subscriberLines({ ...request, subscriber: { ...request.subscriber, sex } })[2],
        'DMG*D8*19500203*U~'
      );
    }
  });

  it('trims the trace and keeps it within the 50 characters TRN02 allows', () => {
    assert.equal(
      subscriberLines({ ...request, trace: ` ${'t'.repeat(60)} ` })[0],
      `TRN*1*${'t'.repeat(50)}*1123456789~`
    );
  });

  it('strips accents and delimiters from names and leaves out a missing first name', () => {
    assert.deepEqual(
      subscriberLines({
        ...request,
        subscriber: { ...request.subscriber, lastName: "O'Brién*Jr", firstName: null }
      })[1],
      "NM1*IL*1*O'BRIEN JR*****MI*1EG4TE5MK73~"
    );
  });

  it('keeps a first name within 35 characters', () => {
    assert.equal(
      subscriberLines({
        ...request,
        subscriber: { ...request.subscriber, firstName: 'J'.repeat(40) }
      })[1],
      `NM1*IL*1*DOE*${'J'.repeat(35)}****MI*1EG4TE5MK73~`
    );
  });

  it('needs at least one subscriber', () => {
    assert.throws(() => build270(submitter, [], envelope), {
      message: 'An eligibility request needs at least one subscriber'
    });
  });
});
