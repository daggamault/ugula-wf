import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build277Status } from './mock-x277-status.ts';
import { claimStatusNote, readClaimStatus } from './x277-status.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'WAYSTAR'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261104*1530*^*00501*000000555*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}GS*HN*WAYSTAR*METROEMS*20261104*1530*555*X*005010X212~${segments.map((s) => `${s}~`).join('')}GE*1*555~IEA*1*000000555~`;

describe('readClaimStatus', () => {
  it('reads the status category, code and amounts of each claim by our trace', () => {
    const statuses = readClaimStatus(
      file(
        'ST*277*0001*005010X212',
        'BHT*0010*08*X*20261104*1530*DG',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*19*1',
        'HL*4*3*22*0',
        'NM1*IL*1*DOE*JANE',
        'TRN*2*1042',
        'STC*F1:65*20261103**1250.50*1000.40',
        'REF*1K*PCN-1',
        'REF*EJ*1042',
        'HL*5*3*22*1',
        'HL*6*5*23',
        'NM1*QC*1*DOE*TIM',
        'TRN*2*1043',
        'STC*A3:21*20261103**300*0*******MEMBER ID INVALID',
        'TRN*2*1044',
        'STC*P1:20*20261103',
        'HL*7*3*22*0',
        'TRN*2*1045',
        'SE*20*0001'
      )
    );
    assert.deepEqual(statuses, [
      {
        trace: '1042',
        claimNumber: '1042',
        payerClaimNumber: 'PCN-1',
        category: 'F1',
        code: '65',
        meaning: 'paid',
        chargeCents: 125_050,
        paidCents: 100_040,
        message: 'Finalized: payment: Claim has been paid'
      },
      {
        trace: '1043',
        claimNumber: '1043',
        payerClaimNumber: null,
        category: 'A3',
        code: '21',
        meaning: 'rejected',
        chargeCents: 30_000,
        paidCents: 0,
        message: 'Returned as unprocessable: MEMBER ID INVALID'
      },
      {
        trace: '1044',
        claimNumber: '1044',
        payerClaimNumber: null,
        category: 'P1',
        code: '20',
        meaning: 'pending',
        chargeCents: 0,
        paidCents: 0,
        message: 'Pending: in process: Accepted for processing'
      }
    ]);
  });

  it('reads what the mock clearinghouse answers and describes it for the claim history', () => {
    const [status] = readClaimStatus(
      build277Status([{ trace: '7', claimNumber: '7', category: 'ZZ', code: '' }])
    );
    assert.equal(status?.meaning, 'pending');
    assert.equal(status?.message, 'Status ZZ');
    assert.equal(
      claimStatusNote({
        meaning: 'inProcess',
        category: 'A2',
        code: '20',
        message: 'Accepted into adjudication'
      }),
      'In process (A2:20): Accepted into adjudication'
    );
    assert.equal(readClaimStatus(file('ST*277*0001*005010X212', 'SE*2*0001')).length, 0);
  });
});
