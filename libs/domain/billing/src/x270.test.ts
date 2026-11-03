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

describe('build270', () => {
  it('asks about health plan coverage for each subscriber on the date of service', () => {
    const lines = build270(
      submitter,
      [
        request,
        {
          ...request,
          trace: 'cov-2',
          payer: { name: 'Blue Plan', payerId: 'BCBS1' },
          subscriber: { ...request.subscriber, memberId: 'XYZ', birthDate: null, sex: null }
        }
      ],
      envelope
    )
      .trim()
      .split('\n');
    assert.ok(lines[0]?.endsWith('*000000042*0*P*:~'));
    assert.deepEqual(lines.slice(1), [
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
      'DTP*291*D8*20261001~',
      'EQ*30~',
      'SE*22*0001~',
      'GE*1*42~',
      'IEA*1*000000042~'
    ]);
  });

  it('sends an unknown sex as U and keeps the trace within TRN02 limits', () => {
    const lines = build270(
      { ...submitter, production: false },
      [
        {
          ...request,
          trace: ` ${'t'.repeat(60)} `,
          subscriber: { ...request.subscriber, lastName: "O'Brién*Jr", sex: 'X' }
        }
      ],
      envelope
    )
      .trim()
      .split('\n');
    assert.ok(lines[0]?.endsWith('*000000042*0*T*:~'));
    assert.ok(lines.includes(`TRN*1*${'t'.repeat(50)}*1123456789~`));
    assert.ok(lines.includes("NM1*IL*1*O'BRIEN JR*JANE****MI*1EG4TE5MK73~"));
    assert.ok(lines.includes('DMG*D8*19500203*U~'));
  });

  it('needs at least one subscriber', () => {
    assert.throws(() => build270(submitter, [], envelope), /at least one subscriber/);
  });
});
