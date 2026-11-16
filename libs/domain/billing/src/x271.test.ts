import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read271 } from './x271.ts';

const isaOf = (repetition: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261024*0805*${repetition}*00501*000000888*0*P*:~`;

const ISA = isaOf('^');

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
      advantagePlan: null,
      stay: null,
      messages: []
    });
    assert.deepEqual(inactive, {
      trace: 'cov-2',
      active: false,
      planName: 'BLUE PPO',
      coverageStart: '2024-01-01',
      coverageEnd: '2025-12-31',
      advantagePlan: null,
      stay: null,
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
      advantagePlan: null,
      stay: null,
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
        advantagePlan: null,
        stay: null,
        messages: []
      },
      {
        trace: 'cov-5',
        active: false,
        planName: null,
        coverageStart: null,
        coverageEnd: null,
        advantagePlan: null,
        stay: null,
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

  it("keeps one payer's rejections off the next payer's members", () => {
    const results = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
        'AAA*Y**42*R',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-1',
        'HL*4**20*1',
        'NM1*PR*2*BLUE*****PI*BLUE',
        'HL*5*4*21*1',
        'HL*6*5*22*0',
        'TRN*2*cov-2',
        'EB*1**30**BLUE PPO',
        'SE*13*0001'
      )
    );
    assert.deepEqual(
      results.map((r) => [r.trace, r.messages]),
      [
        ['cov-1', ['The payer is unable to respond now']],
        ['cov-2', []]
      ]
    );
  });

  it('reads a hospital or nursing facility stay with its admission and discharge dates', () => {
    const [inpatient, snf, undated] = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-10',
        'EB*1**30**MEDICARE PART A',
        'DTP*346*D8*20150101',
        'EB*X**48',
        'DTP*435*D8*20261020',
        'HL*4*2*22*0',
        'TRN*2*cov-11',
        'EB*1**AG^30',
        'DTP*472*RD8*20261001-20261015',
        'HL*5*2*22*0',
        'TRN*2*cov-12',
        'EB*1**48',
        'SE*16*0001'
      )
    );
    assert.deepEqual(inpatient?.stay, {
      kind: 'inpatient',
      admittedOn: '2026-10-20',
      dischargedOn: null
    });
    assert.equal(inpatient?.coverageStart, '2015-01-01');
    assert.deepEqual(snf?.stay, {
      kind: 'snf',
      admittedOn: '2026-10-01',
      dischargedOn: '2026-10-15'
    });
    assert.equal(undated?.stay, null);
  });

  it('splits repeated service types on the separator the interchange declares', () => {
    const text = file(
      'ST*271*0001*005010X279A1',
      'HL*1**20*1',
      'HL*2*1*21*1',
      'HL*3*2*22*0',
      'TRN*2*cov-20',
      'EB*1**30{AG',
      'DTP*472*RD8*20261001-20261015',
      'SE*8*0001'
    );
    const [braced] = read271(text.replace(ISA, isaOf('{')));
    assert.equal(braced?.stay?.kind, 'snf');
    const [caret] = read271(text);
    assert.equal(caret?.stay, null);
  });

  it('names the Medicare Advantage plan a Medicare response points to', () => {
    const [named, unnamed] = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-7',
        'EB*1**30**MEDICARE PART B',
        'EB*R**30*HN',
        'DTP*290*RD8*20260101-20261231',
        'LS*2120',
        'NM1*PRP*2*SUNSHINE ADVANTAGE*****PI*H1234',
        'LE*2120',
        'HL*4*2*22*0',
        'TRN*2*cov-8',
        'EB*1**30',
        'EB*R**30*PR*SILVER PPO PLAN',
        'EB*R**30*MB',
        'SE*17*0001'
      )
    );
    assert.equal(named?.advantagePlan, 'SUNSHINE ADVANTAGE');
    assert.equal(named?.coverageStart, null);
    assert.equal(unnamed?.advantagePlan, 'SILVER PPO PLAN');
    assert.equal(read271(RESPONSE)[0]?.advantagePlan, null);
  });

  it('keeps the first dates and stay, and fills in what a response leaves out', () => {
    const text = file(
      'ST*271*0001*005010X279A1',
      'HL*1**20*1',
      'MSG*Payer notice',
      'EB*1**30**BEFORE ANY MEMBER',
      'HL*2*1*21*1',
      'HL*3*2*22*0',
      'TRN*2',
      'TRN*2*cov-late',
      'EB',
      'EB*R**30',
      'MSG*',
      'AAA*N',
      'DTP*346',
      'DTP*346*D8*20260101',
      'DTP*346*D8*20250101',
      'DTP*347*D8*20261231',
      'DTP*347*D8*20271231',
      'DTP*291*RD8*20200101-20201231',
      'EB*1**48',
      'DTP*435*D8*20261020',
      'DTP*435*D8*20261021',
      'DTP*096*D8*20261025',
      'DTP*096*D8*20261026',
      'DTP*472*RD8*20261001-20261002',
      'EB*1**AG',
      'DTP*435*D8*20260101',
      'HL*9',
      'EB*1**30**AFTER A NON-MEMBER LEVEL',
      'HL*4*2*22*0',
      'TRN*2*cov-b',
      'EB*R**30*HM',
      'NM1',
      'NM1*PRP*2',
      'DTP*346*D8*20260101',
      'EB*1**30**PLAN B',
      'DTP*291*D8*20260101',
      'DTP*472*D8*20260101',
      'SE*38*0001'
    );
    assert.deepEqual(read271(text.replace(ISA, isaOf('U'))), [
      {
        trace: '',
        active: true,
        planName: null,
        coverageStart: '2026-01-01',
        coverageEnd: '2026-12-31',
        advantagePlan: null,
        stay: { kind: 'inpatient', admittedOn: '2026-10-20', dischargedOn: '2026-10-25' },
        messages: ['Payer notice', 'Rejected with reason not given']
      },
      {
        trace: 'cov-b',
        active: true,
        planName: 'PLAN B',
        coverageStart: null,
        coverageEnd: null,
        advantagePlan: 'A Medicare Advantage plan',
        stay: null,
        messages: ['Payer notice']
      }
    ]);
  });

  it('reads a single 472 date as an admission with no discharge', () => {
    const [result] = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-1',
        'EB*1**48',
        'DTP*472*D8*20261001',
        'DTP*435*D8*bad',
        'SE*9*0001'
      )
    );
    assert.deepEqual(result?.stay, {
      kind: 'inpatient',
      admittedOn: '2026-10-01',
      dischargedOn: null
    });
  });

  it('leaves dates it cannot read empty, and drops a stay with no admission', () => {
    const [result] = read271(
      file(
        'ST*271*0001*005010X279A1',
        'HL*1**20*1',
        'HL*2*1*21*1',
        'HL*3*2*22*0',
        'TRN*2*cov-1',
        'DTP*347*D8*2026',
        'DTP*291*RD8*bad',
        'EB*6**48',
        'DTP*096*D8*bad',
        'DTP*435*D8*bad',
        'SE*11*0001'
      )
    );
    assert.deepEqual(result, {
      trace: 'cov-1',
      active: false,
      planName: null,
      coverageStart: null,
      coverageEnd: null,
      advantagePlan: null,
      stay: null,
      messages: []
    });
  });
});
