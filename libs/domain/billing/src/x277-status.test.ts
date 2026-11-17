import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { claimStatusNote, type PayerClaimStatus, readClaimStatus } from './x277-status.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'WAYSTAR'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261104*1530*^*00501*000000555*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}GS*HN*WAYSTAR*METROEMS*20261104*1530*555*X*005010X212~${segments.map((s) => `${s}~`).join('')}GE*1*555~IEA*1*000000555~`;

const claim = (...segments: string[]) =>
  readClaimStatus(
    file('ST*277*0001*005010X212', 'HL*1**20*1', 'HL*2*1*22*0', ...segments, 'SE*99*0001')
  );

const status = (trace: string, s: Partial<PayerClaimStatus>): PayerClaimStatus => ({
  trace,
  claimNumber: trace,
  payerClaimNumber: null,
  category: 'A2',
  code: '',
  meaning: 'inProcess',
  chargeCents: 0,
  paidCents: 0,
  message: 'Accepted into adjudication',
  ...s
});

describe('readClaimStatus', () => {
  it('reads the status category, code, amounts and payer claim number of a claim by our trace', () => {
    assert.deepEqual(
      readClaimStatus(
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
          'SE*12*0001'
        )
      ),
      [
        status('1042', {
          payerClaimNumber: 'PCN-1',
          category: 'F1',
          code: '65',
          meaning: 'paid',
          chargeCents: 125_050,
          paidCents: 100_040,
          message: 'Finalized: payment: Claim has been paid'
        })
      ]
    );
  });

  it('reads each traced claim under a dependent, preferring the status message to the code', () => {
    assert.deepEqual(
      readClaimStatus(
        file(
          'ST*277*0001*005010X212',
          'HL*1**20*1',
          'HL*5*1*22*1',
          'HL*6*5*23',
          'NM1*QC*1*DOE*TIM',
          'TRN*2*1043',
          'STC*A3:21*20261103**300*0*******MEMBER ID INVALID',
          'TRN*2*1044',
          'STC*P1:20*20261103',
          'SE*10*0001'
        )
      ),
      [
        status('1043', {
          category: 'A3',
          code: '21',
          meaning: 'rejected',
          chargeCents: 30_000,
          message: 'Returned as unprocessable: MEMBER ID INVALID'
        }),
        status('1044', {
          category: 'P1',
          code: '20',
          meaning: 'pending',
          message: 'Pending: in process: Accepted for processing'
        })
      ]
    );
  });

  it('keeps our claim number apart from the trace when both are given', () => {
    assert.deepEqual(claim('TRN*2*T-1', 'STC*A2*20261103', 'REF*EJ*C-1'), [
      { ...status('T-1', {}), claimNumber: 'C-1' }
    ]);
  });

  it('falls back to the claim number for the trace and keeps the first of each reference and status', () => {
    assert.deepEqual(
      claim(
        'REF*EJ*CLM-9',
        'REF*EJ*CLM-10',
        'REF*1K*PCN-9',
        'REF*1K*PCN-10',
        'STC*F2:999*20261103**100',
        'STC*F1:65*20261103**100*100'
      ),
      [
        status('CLM-9', {
          payerClaimNumber: 'PCN-9',
          category: 'F2',
          code: '999',
          meaning: 'denied',
          chargeCents: 10_000,
          message: 'Finalized: denial: Status code 999'
        })
      ]
    );
  });

  it('skips a claim with a status but neither trace nor claim number', () => {
    assert.deepEqual(claim('STC*A1:20*20261103'), []);
  });

  it('skips a traced claim with no status', () => {
    assert.deepEqual(claim('TRN*2*1045'), []);
  });

  it('ignores statuses outside a claim level', () => {
    assert.deepEqual(
      readClaimStatus(
        file(
          'ST*277*0001*005010X212',
          'HL*1**20*1',
          'TRN*2*PAYER',
          'STC*F1:65*20261103**50*50',
          'HL*3',
          'TRN*2*IGNORED',
          'STC*F1:65*20261103**50*50',
          'SE*8*0001'
        )
      ),
      []
    );
  });

  it('describes a status without a code by its category alone and reads bad amounts as zero', () => {
    assert.deepEqual(claim('TRN*2*TR-1', 'STC*A2*20261103**abc'), [status('TR-1', {})]);
  });

  it('treats a category it does not know as pending', () => {
    assert.deepEqual(claim('TRN*2*7', 'STC*ZZ*20261103'), [
      status('7', { category: 'ZZ', meaning: 'pending', message: 'Status ZZ' })
    ]);
  });

  it('reads nothing from a response without claims', () => {
    assert.deepEqual(readClaimStatus(file('ST*277*0001*005010X212', 'SE*2*0001')), []);
  });
});

describe('claimStatusNote', () => {
  it('describes a status for the claim history with its category and code', () => {
    assert.equal(
      claimStatusNote({
        meaning: 'inProcess',
        category: 'A2',
        code: '20',
        message: 'Accepted into adjudication'
      }),
      'In process (A2:20): Accepted into adjudication'
    );
  });

  it('leaves out a missing code', () => {
    assert.equal(
      claimStatusNote({ meaning: 'unavailable', category: 'E1', code: '', message: 'Down' }),
      'No answer (E1): Down'
    );
  });
});
