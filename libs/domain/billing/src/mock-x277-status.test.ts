import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build277Status } from './mock-x277-status.ts';
import { readClaimStatus } from './x277-status.ts';

const options = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7, receiver: 'ME' };
const paid = {
  trace: 'T-1',
  claimNumber: 'c-1',
  category: 'F1',
  code: '65',
  chargeCents: 10_000,
  paidCents: 8_000,
  payerClaimNumber: 'P-1'
};
const rejected = {
  trace: 'T-2',
  claimNumber: 'c-2',
  category: 'A3',
  code: '21',
  message: 'Bad ID'
};

const claimLoop = (hl: number, payer: string, statusSegments: string[]) => [
  `HL*${hl}**20*1~`,
  payer,
  `HL*${hl + 1}*${hl}*21*1~`,
  'NM1*41*2*DEVELOPMENT EMS*****46*ME~',
  `HL*${hl + 2}*${hl + 1}*19*1~`,
  'NM1*1P*2*DEVELOPMENT EMS*****XX*1234567893~',
  `HL*${hl + 3}*${hl + 2}*22*0~`,
  'NM1*IL*1*PATIENT~',
  ...statusSegments
];

const MEDICARE = 'NM1*PR*2*MEDICARE*****PI*DEMOMCR~';

describe('build277Status', () => {
  it('answers each claim with its own hierarchy, trace, status, amounts and references', () => {
    assert.equal(
      build277Status([paid, rejected], options),
      `${[
        `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*DEMOCH         *ZZ*ME             *261103*1200*^*00501*000000007*0*T*:~`,
        'GS*HN*DEMOCH*ME*20261103*1200*7*X*005010X212~',
        'ST*277*0001*005010X212~',
        'BHT*0010*08*MOCK*20261103*1200*DG~',
        ...claimLoop(1, MEDICARE, [
          'TRN*2*T-1~',
          'STC*F1:65*20261103**100*80~',
          'REF*1K*P-1~',
          'REF*EJ*c-1~'
        ]),
        ...claimLoop(5, MEDICARE, [
          'TRN*2*T-2~',
          'STC*A3:21*20261103**0*0*******Bad ID~',
          'REF*EJ*c-2~'
        ]),
        'SE*26*0001~',
        'GE*1*7~',
        'IEA*1*000000007~'
      ].join('\n')}\n`
    );
  });

  it('names the payer an answer gives instead of the default one', () => {
    const text = build277Status([{ ...rejected, payer: { name: 'Blue Cross', id: 'BCBS1' } }], {
      ...options,
      controlNumber: 8
    });
    assert.equal(text.split('\n')[5], 'NM1*PR*2*BLUE CROSS*****PI*BCBS1~');
  });

  it('reads back as the statuses it was given', () => {
    assert.deepEqual(readClaimStatus(build277Status([paid, rejected], options)), [
      {
        trace: 'T-1',
        claimNumber: 'c-1',
        payerClaimNumber: 'P-1',
        category: 'F1',
        code: '65',
        meaning: 'paid',
        chargeCents: 10_000,
        paidCents: 8_000,
        message: 'Finalized: payment: Claim has been paid'
      },
      {
        trace: 'T-2',
        claimNumber: 'c-2',
        payerClaimNumber: null,
        category: 'A3',
        code: '21',
        meaning: 'rejected',
        chargeCents: 0,
        paidCents: 0,
        message: 'Returned as unprocessable: Bad ID'
      }
    ]);
  });
});
