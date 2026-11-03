import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read835 } from './x835.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'MEDICARE'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261031*0900*^*00501*000000101*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}\nGS*HP*MEDICARE*METROEMS*20261031*0900*101*X*005010X221A1~\n${segments.map((s) => `${s}~`).join('\n')}\nGE*1*101~\nIEA*1*000000101~\n`;

const REMITTANCE = file(
  'ST*835*0001',
  'BPR*I*612.35*C*ACH*CCP*01*999999992*DA*123456*1512345678**01*999988880*DA*98765*20261030',
  'TRN*1*EFT0042*1512345678',
  'DTM*405*20261029',
  'N1*PR*MEDICARE PART B*XV*DEMOMCR',
  'N3*PO BOX 1',
  'N4*SPRINGFIELD*IL*62701',
  'REF*2U*00952',
  'N1*PE*METRO EMS*XX*1234567893',
  'REF*TJ*123456789',
  'LX*1',
  'CLP*1001*1*942.5*612.35*153.09*MB*ICN111*41',
  'NM1*QC*1*DOE*JANE****MI*1EG4TE5MK73',
  'DTM*232*20261001',
  'SVC*HC:A0427:RH*850*552.2**1',
  'DTM*472*20261001',
  'CAS*CO*45*159.95',
  'CAS*PR*1*100*1*2*37.85',
  'SVC*HC:A0425:RH*92.5*60.15**7.4',
  'CAS*PR*2*15.24',
  'CAS*CO*45*17.11**253*0.0',
  'CLP*1002*4*500*0*0*MB*ICN222',
  'CAS*CO*50*500',
  'CLP*1001*22*-942.5*-612.35*-153.09*MB*ICN111',
  'CAS*CO*45*-177.06',
  'CAS*PR*1*-100**2*-53.09',
  'CAS*XX*1*5',
  'PLB*1234567893*20261231*WO:ICN999*25.5*L6:INTEREST*-1.25',
  'SE*29*0001',
  'ST*835*0002',
  'BPR*H*0*C*NON************20261030',
  'TRN*1*NOPAY77*1512345678',
  'N1*PR*BLUE PLAN',
  'REF*2U*BCBS1',
  'N1*PE*METRO EMS*XX*1234567893',
  'SE*7*0002'
);

describe('read835', () => {
  const [medicare, blue] = read835(REMITTANCE);

  it('reads the payment, payer and check of each remittance', () => {
    assert.deepEqual(
      [medicare?.payerName, medicare?.payerId, medicare?.checkNumber, medicare?.paidOn],
      ['MEDICARE PART B', 'DEMOMCR', 'EFT0042', '2026-10-30']
    );
    assert.equal(medicare?.totalCents, 61_235);
    assert.equal(medicare?.providerAdjustmentCents, 2425);
    assert.deepEqual(
      [blue?.payerName, blue?.payerId, blue?.checkNumber, blue?.totalCents, blue?.claims],
      ['BLUE PLAN', 'BCBS1', 'NOPAY77', 0, []]
    );
  });

  it('collects claim and line adjustments for each paid claim', () => {
    assert.deepEqual(medicare?.claims[0], {
      claimNumber: '1001',
      status: '1',
      chargeCents: 94_250,
      paidCents: 61_235,
      patientCents: 15_309,
      payerClaimNumber: 'ICN111',
      adjustments: [
        { group: 'CO', reason: '45', cents: 15_995 },
        { group: 'PR', reason: '1', cents: 10_000 },
        { group: 'PR', reason: '2', cents: 3785 },
        { group: 'PR', reason: '2', cents: 1524 },
        { group: 'CO', reason: '45', cents: 1711 },
        { group: 'CO', reason: '253', cents: 0 }
      ],
      denied: false,
      reversal: false
    });
  });

  it('flags denials and reversals, keeping negative amounts and skipping unknown groups', () => {
    const [, denied, reversed] = medicare?.claims ?? [];
    assert.deepEqual(
      [denied?.denied, denied?.paidCents, denied?.adjustments],
      [true, 0, [{ group: 'CO', reason: '50', cents: 50_000 }]]
    );
    assert.deepEqual(
      [
        reversed?.claimNumber,
        reversed?.reversal,
        reversed?.denied,
        reversed?.chargeCents,
        reversed?.paidCents,
        reversed?.patientCents,
        reversed?.adjustments
      ],
      [
        '1001',
        true,
        false,
        -94_250,
        -61_235,
        -15_309,
        [
          { group: 'CO', reason: '45', cents: -17_706 },
          { group: 'PR', reason: '1', cents: -10_000 },
          { group: 'PR', reason: '2', cents: -5309 }
        ]
      ]
    );
  });

  it('balances each claim: charge equals payment plus every adjustment', () => {
    for (const c of medicare?.claims ?? []) {
      const adjusted = c.adjustments.reduce((sum, a) => sum + a.cents, 0);
      assert.equal(c.chargeCents, c.paidCents + adjusted, c.claimNumber);
    }
  });

  it('nets every provider-level adjustment pair, interest included', () => {
    const [plb] = read835(
      file(
        'ST*835*0001',
        'BPR*I*0*C*NON************20261030',
        'TRN*1*EFT1*1512345678',
        'N1*PR*MEDICARE*XV*DEMOMCR',
        'PLB*1234567893*20261231*WO:ICN1*10*WO:ICN2*20*FB:1*-5*L6*-0.5*72:A*1*90:B*2',
        'PLB*1234567893*20261231*J1*0.25',
        'SE*7*0001'
      )
    );
    assert.equal(plb?.providerAdjustmentCents, 2775);
    assert.deepEqual(plb?.claims, []);
  });

  it('ignores adjustments that come before any claim and reads the payer ID from REF*2U', () => {
    const [r] = read835(
      file(
        'ST*835*0001',
        'BPR*I*100*C*ACH*CCP*01*1*DA*1*1**01*1*DA*1*20261030',
        'TRN*1*EFT2*1512345678',
        'TRN*1*EFT3*1512345678',
        'N1*PR*MEDICAID',
        'REF*2U*MCD01',
        'CAS*CO*45*1',
        'LX*1',
        'CLP* 77 *2*100*100*0*MC',
        'REF*2U*IGNORED',
        'SE*10*0001'
      )
    );
    assert.deepEqual(
      [r?.payerId, r?.checkNumber, r?.paidOn, r?.totalCents],
      ['MCD01', 'EFT2', '2026-10-30', 10_000]
    );
    assert.deepEqual(r?.claims, [
      {
        claimNumber: '77',
        status: '2',
        chargeCents: 10_000,
        paidCents: 10_000,
        patientCents: 0,
        payerClaimNumber: null,
        adjustments: [],
        denied: false,
        reversal: false
      }
    ]);
  });

  it('reads nothing from files that carry no remittance', () => {
    assert.deepEqual(read835(file('ST*999*0001', 'AK1*HC*1', 'SE*3*0001')), []);
  });
});
