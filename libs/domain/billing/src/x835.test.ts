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
  'MOA***MA01*N130',
  'NM1*QC*1*DOE*JANE****MI*1EG4TE5MK73',
  'DTM*232*20261001',
  'SVC*HC:A0427:RH*850*552.2**1',
  'DTM*472*20261001',
  'REF*6R*1',
  'CAS*CO*45*159.95',
  'LQ*HE*N130',
  'LQ*RX*99',
  'CAS*PR*1*100*1*2*37.85',
  'SVC*HC:A0425:RH*92.5*60.15**7.4*HC:A0425',
  'CAS*PR*2*15.24',
  'CAS*CO*45*17.11**253*0.0',
  'CLP*1002*4*500*0*0*MB*ICN222',
  'CAS*CO*50*500',
  'MIA*0***0*m25',
  'CLP*1001*22*-942.5*-612.35*-153.09*MB*ICN111',
  'CAS*CO*45*-177.06',
  'CAS*PR*1*-100**2*-53.09',
  'CAS*XX*1*5',
  'PLB*1234567893*20261231*WO:ICN999*25.5*L6:INTEREST*-1.25',
  'SE*30*0001',
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

  it('reads one remittance per 835 transaction', () => {
    assert.equal(read835(REMITTANCE).length, 2);
  });

  it('reads the payment, payer, check and provider adjustments of a remittance', () => {
    const { claims: _claims, ...header } = medicare ?? { claims: [] };
    assert.deepEqual(header, {
      payerName: 'MEDICARE PART B',
      payerId: 'DEMOMCR',
      checkNumber: 'EFT0042',
      originatorId: '1512345678',
      paymentMethod: 'ACH',
      paidOn: '2026-10-30',
      totalCents: 61_235,
      providerAdjustments: [
        { reason: 'WO', reference: 'ICN999', cents: 2550 },
        { reason: 'L6', reference: 'INTEREST', cents: -125 }
      ]
    });
  });

  it('reads a remittance that pays nothing, taking the payer ID from REF*2U', () => {
    assert.deepEqual(blue, {
      payerName: 'BLUE PLAN',
      payerId: 'BCBS1',
      checkNumber: 'NOPAY77',
      originatorId: '1512345678',
      paymentMethod: 'NON',
      paidOn: '2026-10-30',
      totalCents: 0,
      providerAdjustments: [],
      claims: []
    });
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
      remarks: ['MA01', 'N130'],
      crossoverPayer: null,
      denied: false,
      reversal: false,
      services: [
        {
          code: 'A0427',
          modifiers: ['RH'],
          chargeCents: 85_000,
          paidCents: 55_220,
          units: 1,
          originalCode: null,
          lineNumber: '1',
          adjustments: [
            { group: 'CO', reason: '45', cents: 15_995 },
            { group: 'PR', reason: '1', cents: 10_000 },
            { group: 'PR', reason: '2', cents: 3785 }
          ]
        },
        {
          code: 'A0425',
          modifiers: ['RH'],
          chargeCents: 9250,
          paidCents: 6015,
          units: 7.4,
          originalCode: 'A0425',
          lineNumber: null,
          adjustments: [
            { group: 'PR', reason: '2', cents: 1524 },
            { group: 'CO', reason: '45', cents: 1711 },
            { group: 'CO', reason: '253', cents: 0 }
          ]
        }
      ]
    });
  });

  it('flags a denial and reads its inpatient remarks upper-cased', () => {
    assert.deepEqual(medicare?.claims[1], {
      claimNumber: '1002',
      status: '4',
      chargeCents: 50_000,
      paidCents: 0,
      patientCents: 0,
      payerClaimNumber: 'ICN222',
      adjustments: [{ group: 'CO', reason: '50', cents: 50_000 }],
      remarks: ['M25'],
      crossoverPayer: null,
      denied: true,
      reversal: false,
      services: []
    });
  });

  it('flags a reversal, keeping negative amounts and skipping unknown adjustment groups', () => {
    assert.deepEqual(medicare?.claims[2], {
      claimNumber: '1001',
      status: '22',
      chargeCents: -94_250,
      paidCents: -61_235,
      patientCents: -15_309,
      payerClaimNumber: 'ICN111',
      adjustments: [
        { group: 'CO', reason: '45', cents: -17_706 },
        { group: 'PR', reason: '1', cents: -10_000 },
        { group: 'PR', reason: '2', cents: -5309 }
      ],
      remarks: [],
      crossoverPayer: null,
      denied: false,
      reversal: true,
      services: []
    });
  });

  it('balances each claim: charge equals payment plus every adjustment', () => {
    for (const c of medicare?.claims ?? []) {
      const adjusted = c.adjustments.reduce((sum, a) => sum + a.cents, 0);
      assert.equal(c.chargeCents, c.paidCents + adjusted, c.claimNumber);
    }
  });

  it('reads every provider-level adjustment pair with its reference, interest included', () => {
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
    assert.deepEqual(plb?.providerAdjustments, [
      { reason: 'WO', reference: 'ICN1', cents: 1000 },
      { reason: 'WO', reference: 'ICN2', cents: 2000 },
      { reason: 'FB', reference: '1', cents: -500 },
      { reason: 'L6', reference: null, cents: -50 },
      { reason: '72', reference: 'A', cents: 100 },
      { reason: '90', reference: 'B', cents: 200 },
      { reason: 'J1', reference: null, cents: 25 }
    ]);
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
      [r?.payerId, r?.checkNumber, r?.originatorId, r?.paymentMethod, r?.paidOn, r?.totalCents],
      ['MCD01', 'EFT2', '1512345678', 'ACH', '2026-10-30', 10_000]
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
        remarks: [],
        crossoverPayer: null,
        denied: false,
        reversal: false,
        services: []
      }
    ]);
  });

  it('names the payer a claim crossed over to and reads services with missing elements', () => {
    const [r] = read835(
      file(
        'ST*835*0001',
        'BPR*I*80*C*ACH*CCP*01*1*DA*1*1**01*1*DA*1*20261030',
        'TRN*1*EFT4*1512345678',
        'N1*PR*MEDICARE*XV*DEMOMCR',
        'N1',
        'REF*2U*NOT-A-PAYER',
        'SVC*HC:A0428*100*80**1',
        'NM1*TT*2*IGNORED BEFORE A CLAIM',
        'CLP*2001*19*100*80*20*MB*ICN333',
        'NM1*TT*2*STATE MEDICAID*****PI*MCD01',
        'NM1*PR*2*NOT A CROSSOVER',
        'SVC*HC*100*80',
        'SVC*HC:A0425::RH: :GY*5*4**abc',
        'SVC*HC:A0425*5*4** 2.5 ',
        'CLP',
        'SE*16*0001'
      )
    );
    assert.equal(r?.payerId, 'DEMOMCR');
    assert.deepEqual(r?.claims, [
      {
        claimNumber: '2001',
        status: '19',
        chargeCents: 10_000,
        paidCents: 8000,
        patientCents: 2000,
        payerClaimNumber: 'ICN333',
        adjustments: [],
        remarks: [],
        crossoverPayer: 'STATE MEDICAID',
        denied: false,
        reversal: false,
        services: [
          {
            code: '',
            modifiers: [],
            chargeCents: 10_000,
            paidCents: 8000,
            units: 1,
            originalCode: null,
            lineNumber: null,
            adjustments: []
          },
          {
            code: 'A0425',
            modifiers: ['RH', 'GY'],
            chargeCents: 500,
            paidCents: 400,
            units: 1,
            originalCode: null,
            lineNumber: null,
            adjustments: []
          },
          {
            code: 'A0425',
            modifiers: [],
            chargeCents: 500,
            paidCents: 400,
            units: 2.5,
            originalCode: null,
            lineNumber: null,
            adjustments: []
          }
        ]
      },
      {
        claimNumber: '',
        status: '',
        chargeCents: 0,
        paidCents: 0,
        patientCents: 0,
        payerClaimNumber: null,
        adjustments: [],
        remarks: [],
        crossoverPayer: null,
        denied: false,
        reversal: false,
        services: []
      }
    ]);
  });

  it('keeps at most four modifiers, line numbers only on services and each remark once', () => {
    const [r] = read835(
      file(
        'ST*835*0001',
        'BPR*I*1*C*ACH*CCP*01*1*DA*1*1**01*1*DA*1*20261030',
        'N1*PR*MEDICARE',
        'CLP*3001*1*1*1*0*MB',
        'REF*6R*CLAIM-LEVEL',
        'MOA***ma01*MA01',
        'LQ*HE*ma01',
        'LQ*HE*N130',
        'SVC*HC:A0425:RH:GY:QM:QN:GA*1*1**1',
        'REF*6R*7',
        'SE*11*0001'
      )
    );
    const [claim] = r?.claims ?? [];
    assert.deepEqual(claim?.remarks, ['MA01', 'N130']);
    assert.deepEqual(claim?.services, [
      {
        code: 'A0425',
        modifiers: ['RH', 'GY', 'QM', 'QN'],
        chargeCents: 100,
        paidCents: 100,
        units: 1,
        originalCode: null,
        lineNumber: '7',
        adjustments: []
      }
    ]);
  });

  it('reads nothing from files that carry no remittance', () => {
    assert.deepEqual(read835(file('ST*999*0001', 'AK1*HC*1', 'SE*3*0001')), []);
  });
});
