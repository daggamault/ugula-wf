import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sampleSubmitter } from './testing.ts';
import { build276, type ClaimStatusInquiry } from './x276.ts';

const inquiry: ClaimStatusInquiry = {
  trace: '1042',
  payer: { name: 'Medicare Part B', payerId: 'DEMOMCR' },
  subscriber: {
    lastName: 'Doe',
    firstName: 'Jane',
    memberId: '1EG4TE5MK73',
    birthDate: '1950-02-03',
    sex: 'F'
  },
  patient: null,
  claimNumber: '1042',
  payerClaimNumber: null,
  chargeCents: 125_050,
  serviceDate: '2026-10-01'
};

const envelope = { controlNumber: 77, createdAt: new Date('2026-11-04T15:30:00Z') };

describe('build276', () => {
  it('asks the payer about each claim by our claim number, charge and date of service', () => {
    const lines = build276(
      { ...sampleSubmitter, receiverId: 'WAYSTAR' },
      [inquiry, { ...inquiry, trace: '1043', claimNumber: '1043', payerClaimNumber: 'PCN-9' }],
      envelope
    )
      .trim()
      .split('\n');
    assert.ok(lines[0]?.includes('*WAYSTAR        *') && lines[0]?.endsWith('*000000077*0*T*:~'));
    assert.equal(
      lines[1],
      `GS*HR*${sampleSubmitter.submitterId}*WAYSTAR*20261104*1530*77*X*005010X212~`
    );
    assert.deepEqual(lines.slice(2, 17), [
      'ST*276*0001*005010X212~',
      'BHT*0010*13*000000077*20261104*1530~',
      'HL*1**20*1~',
      'NM1*PR*2*MEDICARE PART B*****PI*DEMOMCR~',
      'HL*2*1*21*1~',
      `NM1*41*2*${sampleSubmitter.organizationName.toUpperCase()}*****46*${sampleSubmitter.submitterId}~`,
      'HL*3*2*19*1~',
      `NM1*1P*2*${sampleSubmitter.organizationName.toUpperCase()}*****XX*${sampleSubmitter.npi}~`,
      'HL*4*3*22*0~',
      'DMG*D8*19500203*F~',
      'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~',
      'TRN*1*1042~',
      'REF*EJ*1042~',
      'AMT*T3*1250.50~',
      'DTP*472*RD8*20261001-20261001~'
    ]);
    assert.ok(lines.includes('HL*5**20*1~') && lines.includes('REF*1K*PCN-9~'));
    assert.equal(lines.at(-3), `SE*${lines.length - 4}*0001~`);
  });

  it('puts the claim under the patient when the patient is not the subscriber', () => {
    const text = build276(
      sampleSubmitter,
      [
        {
          ...inquiry,
          subscriber: { ...inquiry.subscriber, birthDate: null },
          patient: { lastName: 'Doe', firstName: 'Tim', birthDate: '2015-06-01', sex: 'X' }
        }
      ],
      envelope
    );
    assert.ok(text.includes('HL*4*3*22*1~\nNM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~\nHL*5*4*23~'));
    assert.ok(text.includes('DMG*D8*20150601*U~\nNM1*QC*1*DOE*TIM~\nTRN*1*1042~'));
    assert.throws(() => build276(sampleSubmitter, [], envelope), /at least one claim/);
  });
});
