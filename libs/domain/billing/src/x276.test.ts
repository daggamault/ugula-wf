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

const linesOf = (text: string) => text.trim().split('\n');

const inquiryLines = (q: ClaimStatusInquiry) =>
  linesOf(build276(sampleSubmitter, [q], envelope)).slice(10, -3);

describe('build276', () => {
  it('asks the payer about each claim by our claim number, charge and date of service', () => {
    const text = build276(
      { ...sampleSubmitter, receiverId: 'WAYSTAR' },
      [inquiry, { ...inquiry, trace: '1043', claimNumber: '1043', payerClaimNumber: 'PCN-9' }],
      envelope
    );
    assert.equal(
      text,
      `${[
        `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*SUB01          *ZZ*WAYSTAR        *261104*1530*^*00501*000000077*0*T*:~`,
        'GS*HR*SUB01*WAYSTAR*20261104*1530*77*X*005010X212~',
        'ST*276*0001*005010X212~',
        'BHT*0010*13*000000077*20261104*1530~',
        'HL*1**20*1~',
        'NM1*PR*2*MEDICARE PART B*****PI*DEMOMCR~',
        'HL*2*1*21*1~',
        'NM1*41*2*METRO EMS*****46*SUB01~',
        'HL*3*2*19*1~',
        'NM1*1P*2*METRO EMS*****XX*1234567893~',
        'HL*4*3*22*0~',
        'DMG*D8*19500203*F~',
        'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~',
        'TRN*1*1042~',
        'REF*EJ*1042~',
        'AMT*T3*1250.5~',
        'DTP*472*RD8*20261001-20261001~',
        'HL*5**20*1~',
        'NM1*PR*2*MEDICARE PART B*****PI*DEMOMCR~',
        'HL*6*5*21*1~',
        'NM1*41*2*METRO EMS*****46*SUB01~',
        'HL*7*6*19*1~',
        'NM1*1P*2*METRO EMS*****XX*1234567893~',
        'HL*8*7*22*0~',
        'DMG*D8*19500203*F~',
        'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~',
        'TRN*1*1043~',
        'REF*1K*PCN-9~',
        'REF*EJ*1043~',
        'AMT*T3*1250.5~',
        'DTP*472*RD8*20261001-20261001~',
        'SE*30*0001~',
        'GE*1*77~',
        'IEA*1*000000077~'
      ].join('\n')}\n`
    );
  });

  it('puts the claim under the patient when the patient is not the subscriber', () => {
    assert.deepEqual(
      inquiryLines({
        ...inquiry,
        patient: { lastName: 'Doe', firstName: 'Tim', birthDate: '2015-06-01', sex: 'M' }
      }),
      [
        'HL*4*3*22*1~',
        'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~',
        'HL*5*4*23~',
        'DMG*D8*20150601*M~',
        'NM1*QC*1*DOE*TIM~',
        'TRN*1*1042~',
        'REF*EJ*1042~',
        'AMT*T3*1250.5~',
        'DTP*472*RD8*20261001-20261001~'
      ]
    );
  });

  it('numbers the next claim after the patient level of a dependent claim', () => {
    const patient = { lastName: 'Doe', firstName: 'Tim', birthDate: null, sex: null };
    const lines = linesOf(build276(sampleSubmitter, [{ ...inquiry, patient }, inquiry], envelope));
    assert.deepEqual(
      lines.filter((l) => l.startsWith('HL*')),
      [
        'HL*1**20*1~',
        'HL*2*1*21*1~',
        'HL*3*2*19*1~',
        'HL*4*3*22*1~',
        'HL*5*4*23~',
        'HL*6**20*1~',
        'HL*7*6*21*1~',
        'HL*8*7*19*1~',
        'HL*9*8*22*0~'
      ]
    );
  });

  it('leaves out demographics for a patient whose birth date is unknown', () => {
    assert.deepEqual(
      inquiryLines({
        ...inquiry,
        patient: { lastName: 'Doe', firstName: null, birthDate: null, sex: 'M' }
      }).slice(0, 4),
      ['HL*4*3*22*1~', 'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~', 'HL*5*4*23~', 'NM1*QC*1*DOE~']
    );
  });

  it('leaves out demographics for a subscriber whose birth date is unknown', () => {
    assert.deepEqual(
      inquiryLines({ ...inquiry, subscriber: { ...inquiry.subscriber, birthDate: null } }).slice(
        0,
        2
      ),
      ['HL*4*3*22*0~', 'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73~']
    );
  });

  it('sends a missing or unknown sex as U', () => {
    assert.equal(
      inquiryLines({ ...inquiry, subscriber: { ...inquiry.subscriber, sex: null } })[1],
      'DMG*D8*19500203*U~'
    );
    assert.equal(
      inquiryLines({
        ...inquiry,
        patient: { lastName: 'Doe', firstName: 'Tim', birthDate: '2015-06-01', sex: 'X' }
      })[3],
      'DMG*D8*20150601*U~'
    );
  });

  it('sends an empty submitter ID when none is set', () => {
    assert.equal(
      linesOf(build276({ ...sampleSubmitter, submitterId: null }, [inquiry], envelope))[7],
      'NM1*41*2*METRO EMS*****46~'
    );
  });

  it('trims the trace and claim number to 50 characters and cleans the payer claim number', () => {
    assert.deepEqual(
      inquiryLines({
        ...inquiry,
        trace: ` ${'t'.repeat(60)} `,
        claimNumber: ` ${'c'.repeat(60)} `,
        payerClaimNumber: 'PCN*9~'
      }).slice(3, 6),
      [`TRN*1*${'t'.repeat(50)}~`, 'REF*1K*PCN 9~', `REF*EJ*${'c'.repeat(50)}~`]
    );
  });

  it('needs at least one claim', () => {
    assert.throws(() => build276(sampleSubmitter, [], envelope), {
      message: 'A claim status request needs at least one claim'
    });
  });
});
