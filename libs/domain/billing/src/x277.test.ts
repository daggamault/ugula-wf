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

const claim = (...segments: string[]) =>
  read277(
    file(
      'ST*277*0001*005010X214',
      'HL*1**20*1',
      'HL*2*1*21*1',
      'HL*3*2*19*1',
      'HL*4*3*PT',
      ...segments,
      'SE*99*0001'
    )
  );

describe('read277', () => {
  it('reads each claim, ignoring accepted batch-level statuses and claims without a trace', () => {
    assert.deepEqual(read277(ACKNOWLEDGMENT), [
      {
        claimNumber: '1001',
        status: 'accepted',
        categories: ['A2'],
        payerClaimNumber: 'ICN111',
        message: 'Accepted into adjudication'
      },
      {
        claimNumber: '1002',
        status: 'rejected',
        categories: ['A1', 'A7'],
        payerClaimNumber: null,
        message: 'Entity contract or member ID is invalid'
      },
      {
        claimNumber: '1003',
        status: 'rejected',
        categories: ['A3', 'A6'],
        payerClaimNumber: null,
        message: 'Returned as unprocessable; Rejected for missing information'
      },
      {
        claimNumber: '1004',
        status: 'pending',
        categories: ['P1'],
        payerClaimNumber: null,
        message: ''
      }
    ]);
  });

  it('reads the category of all three status elements, once each', () => {
    assert.deepEqual(claim('TRN*2*1001', 'STC*A7:164*20261024*U*0******A7:21*A8:562'), [
      {
        claimNumber: '1001',
        status: 'rejected',
        categories: ['A7', 'A8'],
        payerClaimNumber: null,
        message: 'Rejected for invalid information; Rejected for relational field error'
      }
    ]);
  });

  it('joins every status message over the category descriptions', () => {
    assert.deepEqual(
      claim(
        'TRN*2*1001',
        'STC*A7:164*20261024*U*0********Bad member ID',
        'STC*A6:35*20261024*U*0********Missing NPI'
      ),
      [
        {
          claimNumber: '1001',
          status: 'rejected',
          categories: ['A7', 'A6'],
          payerClaimNumber: null,
          message: 'Bad member ID; Missing NPI'
        }
      ]
    );
  });

  it('accepts a claim the payer split on acceptance', () => {
    assert.deepEqual(claim('TRN*2*1005', 'STC*A5:20*20261024*WQ*942.5', 'REF*1K*ICN555'), [
      {
        claimNumber: '1005',
        status: 'accepted',
        categories: ['A5'],
        payerClaimNumber: 'ICN555',
        message: 'Split claim'
      }
    ]);
  });

  it('accepts a claim forwarded to another entity', () => {
    assert.deepEqual(claim('TRN*2*1006', 'STC*A0:16*20261024*WQ*0'), [
      {
        claimNumber: '1006',
        status: 'accepted',
        categories: ['A0'],
        payerClaimNumber: null,
        message: 'Forwarded to another entity'
      }
    ]);
  });

  it('leaves a claim with no status pending', () => {
    assert.deepEqual(claim('TRN*2*1007'), [
      {
        claimNumber: '1007',
        status: 'pending',
        categories: [],
        payerClaimNumber: null,
        message: ''
      }
    ]);
  });

  it('keeps the first claim trace and payer claim number', () => {
    assert.deepEqual(claim('TRN*2*1008', 'TRN*2*1009', 'REF*1K*ICN1', 'REF*1K*ICN2', 'STC*A1:19'), [
      {
        claimNumber: '1008',
        status: 'accepted',
        categories: ['A1'],
        payerClaimNumber: 'ICN1',
        message: 'Received'
      }
    ]);
  });

  it('reads only 277 transactions', () => {
    assert.deepEqual(
      read277(
        file(
          'ST*999*0001',
          'HL*4*3*PT',
          'TRN*2*1001',
          'STC*A1:19',
          'SE*5*0001',
          'ST*277*0002*005010X214',
          'HL*4*3*PT',
          'TRN*2*1002',
          'STC*A1:19',
          'SE*5*0002'
        )
      ).map((c) => c.claimNumber),
      ['1002']
    );
  });

  it('passes a rejection down from any level above with its message', () => {
    assert.deepEqual(
      read277(
        file(
          'ST*277*0001*005010X214',
          'HL*3**20*1',
          'STC*A8:21*20261024*U*0********BATCH IN ERROR',
          'HL*4*3*21*1',
          'STC*A1:19',
          'HL*5*4*PT',
          'TRN*2*2002',
          'SE*7*0001'
        )
      ),
      [
        {
          claimNumber: '2002',
          status: 'rejected',
          categories: ['A8'],
          payerClaimNumber: null,
          message: 'BATCH IN ERROR'
        }
      ]
    );
  });

  it('skips parents it never saw and levels without an id', () => {
    assert.deepEqual(
      read277(
        file(
          'ST*277*0001*005010X214',
          'HL',
          'STC*A3:21',
          'HL*2*99*PT',
          'TRN*2*2001',
          'STC*A1:19*20261024*WQ*100',
          'SE*6*0001'
        )
      ),
      [
        {
          claimNumber: '2001',
          status: 'accepted',
          categories: ['A1'],
          payerClaimNumber: null,
          message: 'Received'
        }
      ]
    );
  });

  it('ignores statuses before the first level', () => {
    assert.deepEqual(
      read277(file('ST*277*0001*005010X214', 'STC*A3:21', 'HL*4**PT', 'TRN*2*2001', 'SE*4*0001')),
      [
        {
          claimNumber: '2001',
          status: 'pending',
          categories: [],
          payerClaimNumber: null,
          message: ''
        }
      ]
    );
  });
});
