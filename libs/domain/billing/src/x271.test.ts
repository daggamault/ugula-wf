import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read271 } from './x271.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261024*0805*^*00501*000000888*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}GS*HB*CLEARING*METROEMS*20261024*0805*888*X*005010X279A1~${segments.map((s) => `${s}~`).join('')}GE*1*888~IEA*1*000000888~`;

const RESPONSE = file(
  'ST*271*0001*005010X279A1',
  'BHT*0022*11*000000007*20261024*0805',
  'HL*1**20*1',
  'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
  'HL*2*1*21*1',
  'NM1*1P*2*METRO EMS*****XX*1234567893',
  'HL*3*2*22*0',
  'TRN*2*cov-1*11234567890',
  'TRN*1*PAYERTRACE*9DEMOMCR',
  'NM1*IL*1*DOE*JANE****MI*1EG4TE5MK73',
  'DTP*346*D8*20150101',
  'EB*1**30**MEDICARE PART B',
  'EB*6**30**OLD PLAN',
  'HL*4*2*22*0',
  'TRN*2*cov-2*11234567890',
  'NM1*IL*1*ROE*RICHARD****MI*W123',
  'EB*6**30**BLUE PPO',
  'DTP*291*RD8*20240101-20251231',
  'MSG*Coverage terminated',
  'HL*5*2*22*0',
  'TRN*2*cov-3*11234567890',
  'NM1*IL*1*POE*ANNA****MI*BAD',
  'AAA*N**72*C',
  'HL*6*2*22*0',
  'NM1*IL*1*NOTRACE',
  'EB*1',
  'SE*27*0001'
);

describe('read271', () => {
  it('reads active and inactive coverage with plan and dates, by our trace', () => {
    const [active, inactive] = read271(RESPONSE);
    assert.deepEqual(active, {
      trace: 'cov-1',
      active: true,
      planName: 'MEDICARE PART B',
      coverageStart: '2015-01-01',
      coverageEnd: null,
      messages: []
    });
    assert.deepEqual(inactive, {
      trace: 'cov-2',
      active: false,
      planName: 'BLUE PPO',
      coverageStart: '2024-01-01',
      coverageEnd: '2025-12-31',
      messages: ['Coverage terminated']
    });
  });

  it('explains rejections and skips members it cannot trace', () => {
    const results = read271(RESPONSE);
    assert.equal(results.length, 3);
    assert.deepEqual(results[2], {
      trace: 'cov-3',
      active: null,
      planName: null,
      coverageStart: null,
      coverageEnd: null,
      messages: ['Invalid or missing member ID']
    });
  });

  it('reads capitated and pending coverage by the first EB status, with plan begin and end dates', () => {
    const results = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-4',
        'EB*D**30',
        'EB*3**30**MANAGED MEDICAID',
        'EB*6**30**IGNORED',
        'DTP*346*D8*20260101',
        'DTP*347*D8*20261231',
        'HL*4*2*22*0',
        'TRN*2*cov-5',
        'EB*8**30',
        'MSG*Pending investigation',
        'SE*15*0001'
      )
    );
    assert.deepEqual(results, [
      {
        trace: 'cov-4',
        active: true,
        planName: 'MANAGED MEDICAID',
        coverageStart: '2026-01-01',
        coverageEnd: '2026-12-31',
        messages: []
      },
      {
        trace: 'cov-5',
        active: false,
        planName: null,
        coverageStart: null,
        coverageEnd: null,
        messages: ['Pending investigation']
      }
    ]);
  });

  it('adds payer-level rejections to every member', () => {
    const [result] = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
        'AAA*Y**42*R',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-9',
        'AAA*N**99*C',
        'SE*9*0001'
      )
    );
    assert.deepEqual(result?.messages, [
      'The payer is unable to respond now',
      'Rejected with reason 99'
    ]);
  });
});
