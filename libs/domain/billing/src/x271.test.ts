import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type EligibilityResult, read271 } from './x271.ts';

const isaOf = (repetition: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261024*0805*${repetition}*00501*000000888*0*P*:~`;

const ISA = isaOf('^');

const file = (...segments: string[]) =>
  `${ISA}GS*HB*CLEARING*METROEMS*20261024*0805*888*X*005010X279A1~${segments.map((s) => `${s}~`).join('')}GE*1*888~IEA*1*000000888~`;

const member = (trace: string, ...segments: string[]) =>
  file(
    'ST*271*0001*005010X279A1',
    'HL*1**20*1',
    'HL*2*1*21*1',
    'HL*3*2*22*0',
    `TRN*2*${trace}`,
    ...segments,
    'SE*99*0001'
  );

const unknown = (trace: string): EligibilityResult => ({
  trace,
  active: null,
  planName: null,
  coverageStart: null,
  coverageEnd: null,
  advantagePlan: null,
  stay: null,
  messages: []
});

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
  describe('coverage', () => {
    it('reads each traced member by our trace, with plan, dates and payer messages', () => {
      assert.deepEqual(read271(RESPONSE), [
        {
          ...unknown('cov-1'),
          active: true,
          planName: 'MEDICARE PART B',
          coverageStart: '2015-01-01'
        },
        {
          ...unknown('cov-2'),
          active: false,
          planName: 'BLUE PPO',
          coverageStart: '2024-01-01',
          coverageEnd: '2025-12-31',
          messages: ['Coverage terminated']
        },
        { ...unknown('cov-3'), messages: ['Invalid or missing member ID'] }
      ]);
    });

    it('takes whether coverage is active and its plan from the first EB status it knows', () => {
      assert.deepEqual(
        read271(
          member('cov-4', 'EB*D**30', 'EB*3**30**MANAGED MEDICAID', 'EB*6**30**IGNORED', 'EB')
        ),
        [{ ...unknown('cov-4'), active: true, planName: 'MANAGED MEDICAID' }]
      );
    });

    it('reads every active and inactive status code', () => {
      assert.deepEqual(
        ['1', '2', '3', '4', '5', '6', '7', '8', 'D'].map(
          (code) => read271(member('cov-1', `EB*${code}**30`))[0]?.active
        ),
        [true, true, true, true, true, false, false, false, null]
      );
    });

    it('reads plan begin and end dates', () => {
      assert.deepEqual(read271(member('cov-1', 'DTP*346*D8*20260101', 'DTP*347*D8*20261231')), [
        { ...unknown('cov-1'), coverageStart: '2026-01-01', coverageEnd: '2026-12-31' }
      ]);
    });

    it('keeps the first coverage dates over later ones and over an eligibility range', () => {
      assert.deepEqual(
        read271(
          member(
            'cov-1',
            'DTP*346',
            'DTP*346*D8*20260101',
            'DTP*346*D8*20250101',
            'DTP*347*D8*20261231',
            'DTP*347*D8*20271231',
            'DTP*291*RD8*20200101-20201231'
          )
        ),
        [{ ...unknown('cov-1'), coverageStart: '2026-01-01', coverageEnd: '2026-12-31' }]
      );
    });

    it('reads an eligibility date only when it is a range', () => {
      assert.deepEqual(read271(member('cov-1', 'DTP*291*D8*20260101')), [unknown('cov-1')]);
    });

    it('leaves dates it cannot read empty', () => {
      assert.deepEqual(
        read271(member('cov-1', 'DTP*346*D8*2026', 'DTP*347*D8*bad', 'DTP*291*RD8*bad')),
        [unknown('cov-1')]
      );
    });
  });

  describe('members', () => {
    it('skips members it cannot trace and ignores the payer trace', () => {
      assert.deepEqual(
        read271(
          file(
            'ST*271*0001*005010X279A1',
            'HL*1**20*1',
            'HL*2*1*21*1',
            'HL*3*2*22*0',
            'TRN*1*PAYERTRACE*9DEMOMCR',
            'EB*1',
            'HL*4*2*23*0',
            'TRN*2*dep-1',
            'SE*9*0001'
          )
        ),
        [unknown('dep-1')]
      );
    });

    it('keeps the first member trace', () => {
      assert.deepEqual(read271(member('cov-1', 'TRN*2*cov-2')), [unknown('cov-1')]);
    });

    it('skips a blank member trace and keeps the next one', () => {
      assert.deepEqual(read271(member('', 'TRN*2*cov-late', 'EB*1')), [
        { ...unknown('cov-late'), active: true }
      ]);
    });

    it('reports nothing for a member with only a blank trace', () => {
      assert.deepEqual(read271(member('', 'EB*1')), []);
    });

    it('ignores benefits outside a member level', () => {
      assert.deepEqual(
        read271(
          file(
            'ST*271*0001*005010X279A1',
            'HL*1**20*1',
            'EB*1**30**BEFORE ANY MEMBER',
            'HL*2*1*21*1',
            'HL*3*2*22*0',
            'TRN*2*cov-1',
            'HL*9',
            'EB*1**30**AFTER A NON-MEMBER LEVEL',
            'SE*9*0001'
          )
        ),
        [unknown('cov-1')]
      );
    });

    it('reads members from every 271 transaction and ignores other transactions', () => {
      assert.deepEqual(
        read271(
          file(
            'ST*271*0001*005010X279A1',
            'HL*1**20*1',
            'HL*2*1*21*1',
            'HL*3*2*22*0',
            'TRN*2*cov-1',
            'SE*6*0001',
            'ST*999*0002*005010X231A1',
            'HL*3*2*22*0',
            'TRN*2*not-271',
            'SE*4*0002',
            'ST*271*0003*005010X279A1',
            'HL*1**20*1',
            'HL*2*1*21*1',
            'HL*3*2*22*0',
            'TRN*2*cov-2',
            'SE*6*0003'
          )
        ),
        [unknown('cov-1'), unknown('cov-2')]
      );
    });
  });

  describe('messages', () => {
    it('explains rejections it knows, and names the reason of one it does not', () => {
      assert.deepEqual(read271(member('cov-1', 'AAA*N**75*C', 'AAA*N**99*C', 'AAA*N')), [
        {
          ...unknown('cov-1'),
          messages: [
            'Subscriber not found',
            'Rejected with reason 99',
            'Rejected with reason not given'
          ]
        }
      ]);
    });

    it('keeps payer messages and drops blank ones', () => {
      assert.deepEqual(read271(member('cov-1', 'MSG*Pending investigation', 'MSG*', 'MSG* ')), [
        { ...unknown('cov-1'), messages: ['Pending investigation'] }
      ]);
    });

    it('adds payer-level rejections and messages before every member of that payer', () => {
      assert.deepEqual(
        read271(
          file(
            'ST*271*0001*005010X279A1',
            'HL*1**20*1',
            'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
            'AAA*Y**42*R',
            'MSG*Payer notice',
            'HL*2*1*21*1',
            'HL*3*2*22*0',
            'TRN*2*cov-8',
            'HL*4*2*22*0',
            'TRN*2*cov-9',
            'AAA*N**99*C',
            'SE*12*0001'
          )
        ),
        [
          {
            ...unknown('cov-8'),
            messages: ['The payer is unable to respond now', 'Payer notice']
          },
          {
            ...unknown('cov-9'),
            messages: [
              'The payer is unable to respond now',
              'Payer notice',
              'Rejected with reason 99'
            ]
          }
        ]
      );
    });

    it("keeps one payer's rejections off the next payer's members", () => {
      assert.deepEqual(
        read271(
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
            'SE*13*0001'
          )
        ),
        [
          { ...unknown('cov-1'), messages: ['The payer is unable to respond now'] },
          unknown('cov-2')
        ]
      );
    });
  });

  describe('facility stays', () => {
    it('reads a hospital stay with its admission date, apart from the coverage dates', () => {
      assert.deepEqual(
        read271(
          member(
            'cov-10',
            'EB*1**30**MEDICARE PART A',
            'DTP*346*D8*20150101',
            'EB*X**48',
            'DTP*435*D8*20261020'
          )
        ),
        [
          {
            ...unknown('cov-10'),
            active: true,
            planName: 'MEDICARE PART A',
            coverageStart: '2015-01-01',
            stay: { kind: 'inpatient', admittedOn: '2026-10-20', dischargedOn: null }
          }
        ]
      );
    });

    it('reads a nursing facility stay from a service date range among repeated service types', () => {
      assert.deepEqual(read271(member('cov-11', 'EB*X**AG^30', 'DTP*472*RD8*20261001-20261015')), [
        {
          ...unknown('cov-11'),
          stay: { kind: 'snf', admittedOn: '2026-10-01', dischargedOn: '2026-10-15' }
        }
      ]);
    });

    it('reads a single service date as an admission with no discharge', () => {
      assert.deepEqual(read271(member('cov-1', 'EB*X**48', 'DTP*472*D8*20261001')), [
        {
          ...unknown('cov-1'),
          stay: { kind: 'inpatient', admittedOn: '2026-10-01', dischargedOn: null }
        }
      ]);
    });

    it('keeps the first admission and discharge dates and the first kind of stay', () => {
      assert.deepEqual(
        read271(
          member(
            'cov-1',
            'EB*X**48',
            'DTP*435*D8*bad',
            'DTP*435*D8*20261020',
            'DTP*435*D8*20261021',
            'DTP*096*D8*20261025',
            'DTP*096*D8*20261026',
            'DTP*472*RD8*20261001-20261002',
            'EB*X**AG',
            'DTP*435*D8*20260101'
          )
        ),
        [
          {
            ...unknown('cov-1'),
            stay: { kind: 'inpatient', admittedOn: '2026-10-20', dischargedOn: '2026-10-25' }
          }
        ]
      );
    });

    it('drops a stay with no admission date', () => {
      assert.deepEqual(read271(member('cov-1', 'EB*X**48', 'DTP*096*D8*20261025')), [
        unknown('cov-1')
      ]);
    });

    it('splits repeated service types on the separator the interchange declares', () => {
      const text = member('cov-20', 'EB*X**30{AG', 'DTP*472*RD8*20261001-20261015');
      assert.deepEqual(read271(text.replace(ISA, isaOf('{'))), [
        {
          ...unknown('cov-20'),
          stay: { kind: 'snf', admittedOn: '2026-10-01', dischargedOn: '2026-10-15' }
        }
      ]);
      assert.deepEqual(read271(text), [unknown('cov-20')]);
    });

    it('reads one service type when the interchange declares no repetition separator', () => {
      assert.deepEqual(
        read271(member('cov-1', 'EB*X**48', 'DTP*435*D8*20261020').replace(ISA, isaOf('U'))),
        [
          {
            ...unknown('cov-1'),
            stay: { kind: 'inpatient', admittedOn: '2026-10-20', dischargedOn: null }
          }
        ]
      );
    });
  });

  describe('Medicare Advantage', () => {
    it('names the plan from the benefit-related entity, ignoring the other plan dates', () => {
      assert.deepEqual(
        read271(
          member(
            'cov-7',
            'EB*1**30**MEDICARE PART B',
            'EB*R**30*HN',
            'DTP*346*D8*20260101',
            'LS*2120',
            'NM1*PRP*2*SUNSHINE ADVANTAGE*****PI*H1234',
            'LE*2120'
          )
        ),
        [
          {
            ...unknown('cov-7'),
            active: true,
            planName: 'MEDICARE PART B',
            advantagePlan: 'SUNSHINE ADVANTAGE'
          }
        ]
      );
    });

    it('names the plan from the benefit when no entity names it', () => {
      assert.deepEqual(read271(member('cov-8', 'EB*R**30*PR*SILVER PPO PLAN', 'NM1*PRP*2')), [
        { ...unknown('cov-8'), advantagePlan: 'SILVER PPO PLAN' }
      ]);
    });

    it('notes an unnamed plan when nothing names it', () => {
      assert.deepEqual(read271(member('cov-1', 'EB*R**30*HM', 'NM1')), [
        { ...unknown('cov-1'), advantagePlan: 'A Medicare Advantage plan' }
      ]);
    });

    it('ignores other payers that are not managed care plans', () => {
      assert.deepEqual(read271(member('cov-1', 'EB*R**30*MB', 'NM1*PRP*2*MEDICARE B')), [
        unknown('cov-1')
      ]);
      assert.deepEqual(read271(member('cov-2', 'EB*R**30')), [unknown('cov-2')]);
    });

    it('reads dates again once a later benefit is not the other plan', () => {
      assert.deepEqual(
        read271(
          member(
            'cov-b',
            'EB*R**30*HM',
            'DTP*346*D8*20250101',
            'EB*1**30**PLAN B',
            'DTP*346*D8*20260101'
          )
        ),
        [
          {
            ...unknown('cov-b'),
            active: true,
            planName: 'PLAN B',
            coverageStart: '2026-01-01',
            advantagePlan: 'A Medicare Advantage plan'
          }
        ]
      );
    });
  });
});
