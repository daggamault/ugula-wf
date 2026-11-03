import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read277 } from './x277.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261024*0800*^*00501*000000777*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}\nGS*HN*CLEARING*METROEMS*20261024*0800*777*X*005010X214~\n${segments.map((s) => `${s}~`).join('\n')}\nGE*1*777~\nIEA*1*000000777~`;

const ACKNOWLEDGMENT = file(
  'ST*277*0001*005010X214',
  'BHT*0085*08*BATCH1*20261024*0800*TH',
  'HL*1**20*1',
  'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
  'TRN*1*BATCH1',
  'DTP*050*D8*20261024',
  'DTP*009*D8*20261024',
  'HL*2*1*21*1',
  'NM1*41*2*METRO EMS*****46*METROEMS',
  'TRN*2*42',
  'STC*A1:19*20261024*WQ*1035',
  'QTY*90*1',
  'HL*3*2*19*1',
  'NM1*85*2*METRO EMS*****XX*1234567893',
  'HL*4*3*PT',
  'NM1*QC*1*DOE*JANE****MI*1EG4TE5MK73',
  'TRN*2*1001',
  'STC*A2:20:PR*20261024*WQ*942.5',
  'REF*1K*ICN111',
  'DTP*472*D8*20261001',
  'HL*5*3*PT',
  'NM1*QC*1*ROE*RICHARD****MI*2EG4TE5MK74',
  'TRN*2*1002',
  'STC*A1:19*20261024*WQ*500',
  'STC*A7:164:IL*20261024*U*500********Entity contract or member ID is invalid',
  'HL*6*3*PT',
  'NM1*QC*1*POE*ANNA',
  'TRN*2*1003',
  'STC*A3:21*20261024*U*120******A6:35',
  'HL*7*3*PT',
  'TRN*2*1004',
  'STC*P1:1*20261024',
  'HL*8*3*PT',
  'NM1*QC*1*NOBODY',
  'SE*35*0001'
);

describe('read277', () => {
  const claims = read277(ACKNOWLEDGMENT);

  it('reads the status of each claim, ignoring batch-level statuses', () => {
    assert.deepEqual(
      claims.map((c) => [c.claimNumber, c.status]),
      [
        ['1001', 'accepted'],
        ['1002', 'rejected'],
        ['1003', 'rejected'],
        ['1004', 'pending']
      ]
    );
  });

  it('keeps the payer claim number and a message for billers', () => {
    assert.deepEqual(claims[0], {
      claimNumber: '1001',
      status: 'accepted',
      categories: ['A2'],
      payerClaimNumber: 'ICN111',
      message: 'Accepted into adjudication'
    });
    assert.deepEqual(claims[1], {
      claimNumber: '1002',
      status: 'rejected',
      categories: ['A1', 'A7'],
      payerClaimNumber: null,
      message: 'Entity contract or member ID is invalid'
    });
    assert.deepEqual(
      [claims[2]?.categories, claims[2]?.message],
      [['A3', 'A6'], 'Returned as unprocessable; Rejected for missing information']
    );
    assert.equal(claims[3]?.message, '');
  });

  it('accepts a claim the payer split on acceptance, and reads only 277 transactions', () => {
    const [split] = read277(
      file(
        'ST*277*0001*005010X214',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*19*1',
        'HL*4*3*PT',
        'TRN*2*1005',
        'STC*A5:20*20261024*WQ*942.5',
        'REF*1K*ICN555',
        'SE*9*0001',
        'ST*999*0002',
        'AK1*HC*1',
        'SE*3*0002'
      )
    );
    assert.deepEqual(split, {
      claimNumber: '1005',
      status: 'accepted',
      categories: ['A5'],
      payerClaimNumber: 'ICN555',
      message: 'Split claim'
    });
    assert.deepEqual(read277(file('ST*999*0001', 'AK1*HC*1', 'SE*3*0001')), []);
  });
});
