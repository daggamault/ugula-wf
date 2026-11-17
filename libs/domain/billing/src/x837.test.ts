import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sampleLine, sampleSubmitter, sampleX837 } from './testing.ts';
import { build837, readX837Claim, submitterIssues, type X837Claim } from './x837.ts';

const submitter = sampleSubmitter;

const base = sampleLine;

const mapped = sampleX837;

const envelope = { controlNumber: 42, createdAt: new Date('2026-10-23T14:05:09Z') };

const segments = (text: string) =>
  text
    .trim()
    .split('~\n')
    .map((s) => s.replace(/~$/, ''));

const build = (...claims: X837Claim[]) => segments(build837(submitter, claims, envelope));

const pick = (segs: string[], ...ids: string[]) =>
  segs.filter((s) => ids.some((id) => s === id || s.startsWith(`${id}*`)));

const claimLoop = (claim: X837Claim) => {
  const segs = build(claim);
  return segs.slice(
    segs.findIndex((s) => s.startsWith('HL*2*')),
    segs.findIndex((s) => s.startsWith('SE*'))
  );
};

const MEDICARE_PRIOR = {
  name: 'Medicare',
  payerId: 'DEMOMCR',
  claimFiling: 'MB',
  memberId: '1EG4TE5MK73',
  groupId: null,
  relationship: '18',
  lastName: "O'Brien",
  firstName: 'José',
  paidOn: '2026-10-20',
  lines: []
};

const ADJUDICATED_LINES = [
  {
    line: 1,
    code: 'A0427',
    modifiers: ['RH'],
    paidCents: 55_220,
    units: 1,
    adjustments: [
      { group: 'CO', reason: '45', cents: 15_995 },
      { group: 'PR', reason: '1', cents: 10_000 },
      { group: 'PR', reason: '2', cents: 3785 }
    ]
  },
  {
    line: 2,
    code: 'A0425',
    modifiers: ['RH'],
    paidCents: 6015,
    units: 7.4,
    adjustments: [
      { group: 'PR', reason: '2', cents: 1524 },
      { group: 'CO', reason: '45', cents: 1711 }
    ]
  }
];

const lineAdjudicated = {
  ...MEDICARE_PRIOR,
  lastName: 'Doe',
  paidCents: 61_235,
  adjustedCents: 17_706,
  adjustments: [
    { group: 'CO', reason: '45', cents: 17_706 },
    { group: 'PR', reason: '1', cents: 10_000 },
    { group: 'PR', reason: '2', cents: 5309 }
  ],
  lines: ADJUDICATED_LINES
};

describe('build837 envelope', () => {
  const file = build837(submitter, [mapped], envelope);
  const segs = segments(file);

  it('writes a whole single-claim file segment by segment', () => {
    assert.deepEqual(segs, [
      'ISA*00*          *00*          *ZZ*SUB01          *ZZ*RCV01          *261023*1405*^*00501*000000042*0*T*:',
      'GS*HC*SUB01*RCV01*20261023*1405*42*X*005010X222A1',
      'ST*837*0001*005010X222A1',
      'BHT*0019*00*000000042*20261023*1405*CH',
      'NM1*41*2*METRO EMS*****46*SUB01',
      'PER*IC*METRO EMS*TE*2175550100',
      'NM1*40*2*DEMO CLEARINGHOUSE*****46*RCV01',
      'HL*1**20*1',
      'PRV*BI*PXC*3416L0300X',
      'NM1*85*2*METRO EMS*****XX*1234567893',
      'N3*1 MAIN ST',
      'N4*SPRINGFIELD*IL*627011234',
      'REF*EI*123456789',
      'HL*2*1*22*0',
      'SBR*P*18*******MB',
      "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73",
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD*IL*62702',
      'DMG*D8*19500203*M',
      'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
      'CLM*c-1*942.5***41:B:1*Y*A*Y*Y',
      'CR1****A*DH*7.4',
      'CRC*07*Y*09*06',
      'HI*ABK:R079*ABF:I10',
      'NM1*PW*2',
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD*IL*62702',
      'NM1*45*2*MERCY HOSPITAL',
      'N3*100 HEALTH WAY',
      'N4*SPRINGFIELD*IL*62702',
      'LX*1',
      'SV1*HC:A0427:RH*850*UN*1***1',
      'DTP*472*D8*20261001',
      'REF*6R*1',
      'LX*2',
      'SV1*HC:A0425:RH*92.5*UN*7.4***1',
      'DTP*472*D8*20261001',
      'REF*6R*2',
      'SE*37*0001',
      'GE*1*42',
      'IEA*1*000000042'
    ]);
  });

  it('pads the ISA to its fixed width of 105 characters', () => {
    assert.equal(segs[0]?.length, 105);
  });

  it('ends every segment with a terminator and a newline', () => {
    assert.ok(file.endsWith('IEA*1*000000042~\n'));
    assert.equal(file.split('~\n').length, segs.length + 1);
  });

  it('refuses control numbers that do not fit the envelope', () => {
    for (const controlNumber of [0, 1e9]) {
      assert.throws(() => build837(submitter, [mapped], { ...envelope, controlNumber }), {
        message: `Control number ${controlNumber} is out of range`
      });
    }
  });

  it('names the receiver by its ID when the billing profile has no receiver name', () => {
    for (const receiverName of [null, '', ' ~ ']) {
      assert.deepEqual(
        pick(segments(build837({ ...submitter, receiverName }, [mapped], envelope)), 'NM1*40'),
        ['NM1*40*2*RCV01*****46*RCV01'],
        String(receiverName)
      );
    }
  });
});

describe('build837 batches', () => {
  it('bills each claim under one billing provider and counts SE01 across them', () => {
    const batch = build(
      mapped,
      { ...mapped, subscriber: { ...mapped.subscriber, relationship: '01', lastName: 'Doe' } },
      mapped
    );
    const st = batch.findIndex((s) => s.startsWith('ST*'));
    const se = batch.findIndex((s) => s.startsWith('SE*'));
    assert.equal(batch[se], `SE*${se - st + 1}*0001`);
    assert.deepEqual(pick(batch, 'HL'), [
      'HL*1**20*1',
      'HL*2*1*22*0',
      'HL*3*1*22*1',
      'HL*4*3*23*0',
      'HL*5*1*22*0'
    ]);
    assert.deepEqual(pick(batch, 'CLM'), [
      'CLM*c-1*942.5***41:B:1*Y*A*Y*Y',
      'CLM*c-1*942.5***41:B:1*Y*A*Y*Y',
      'CLM*c-1*942.5***41:B:1*Y*A*Y*Y'
    ]);
  });

  it('writes a patient loop when the patient is not the subscriber', () => {
    const dependent = build(
      {
        ...mapped,
        subscriber: {
          ...mapped.subscriber,
          relationship: '19',
          lastName: 'Smith',
          firstName: 'Ann'
        }
      },
      mapped
    );
    assert.deepEqual(pick(dependent, 'HL'), [
      'HL*1**20*1',
      'HL*2*1*22*1',
      'HL*3*2*23*0',
      'HL*4*1*22*0'
    ]);
    const at = dependent.indexOf('HL*2*1*22*1');
    assert.deepEqual(dependent.slice(at, at + 10), [
      'HL*2*1*22*1',
      'SBR*P********MB',
      'NM1*IL*1*SMITH*ANN****MI*1EG4TE5MK73',
      'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
      'HL*3*2*23*0',
      'PAT*19',
      "NM1*QC*1*O'BRIEN*JOSE",
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD*IL*62702',
      'DMG*D8*19500203*M'
    ]);
  });
});

describe('build837 text', () => {
  it('strips delimiters and accents from free text', () => {
    assert.deepEqual(pick(build(mapped), 'NM1*IL'), ["NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73"]);
  });

  it('strips separators from every mapped value, codes included', () => {
    const tainted = build({
      ...mapped,
      claimId: 'c~1*2',
      frequency: '1:7',
      patient: { ...mapped.patient, sex: 'M*X' },
      lines: [{ ...base, code: 'A04^27', modifiers: ['R:H'] }]
    });
    assert.deepEqual(pick(tainted, 'CLM', 'DMG', 'SV1'), [
      'DMG*D8*19500203*M X',
      'CLM*c 1 2*850***41:B:1 7*Y*A*Y*Y',
      'SV1*HC:A04 27:R H*850*UN*1***1'
    ]);
  });

  it('cuts the claim note to 80 characters', () => {
    assert.deepEqual(pick(build({ ...mapped, note: 'X'.repeat(90) }), 'NTE'), [
      `NTE*ADD*${'X'.repeat(80)}`
    ]);
  });
});

describe('build837 claim loop', () => {
  it('names pickup and drop-off locations', () => {
    const segs = build(mapped);
    const at = segs.indexOf('NM1*PW*2');
    assert.deepEqual(segs.slice(at, at + 6), [
      'NM1*PW*2',
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD*IL*62702',
      'NM1*45*2*MERCY HOSPITAL',
      'N3*100 HEALTH WAY',
      'N4*SPRINGFIELD*IL*62702'
    ]);
  });

  it('leaves the state and ZIP code off N4 when an address has none', () => {
    const segs = build({
      ...mapped,
      pickup: { ...mapped.pickup, state: null, postalCode: null },
      dropoff: { ...mapped.dropoff, name: null, postalCode: null }
    });
    const at = segs.indexOf('NM1*PW*2');
    assert.deepEqual(segs.slice(at, at + 6), [
      'NM1*PW*2',
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD',
      'NM1*45*2',
      'N3*100 HEALTH WAY',
      'N4*SPRINGFIELD*IL'
    ]);
  });

  it('writes the ambulance conditions it is given, and none when there are none', () => {
    assert.deepEqual(pick(build({ ...mapped, conditionCodes: ['09'] }), 'CRC'), ['CRC*07*Y*09']);
    assert.deepEqual(pick(build({ ...mapped, conditionCodes: [] }), 'CRC'), []);
  });

  it('writes the patient weight and loaded miles as billed, without rounding them again', () => {
    assert.deepEqual(pick(build({ ...mapped, weightPounds: 180 }), 'CR1'), [
      'CR1*LB*180**A*DH*7.4'
    ]);
    assert.deepEqual(pick(build({ ...mapped, loadedMiles: 121 }), 'CR1'), ['CR1****A*DH*121']);
    assert.deepEqual(pick(build({ ...mapped, loadedMiles: 12.3 }), 'CR1'), ['CR1****A*DH*12.3']);
  });

  it('writes treat-no-transport claims without CR1 or a drop-off', () => {
    assert.deepEqual(
      claimLoop({
        ...mapped,
        loadedMiles: null,
        transportReason: null,
        lines: [{ ...base, code: 'A0998', modifiers: ['GY'] }]
      }),
      [
        'HL*2*1*22*0',
        'SBR*P*18*******MB',
        "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73",
        'N3*9 OAK AVE',
        'N4*SPRINGFIELD*IL*62702',
        'DMG*D8*19500203*M',
        'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
        'CLM*c-1*850***41:B:1*Y*A*Y*Y',
        'CRC*07*Y*09*06',
        'HI*ABK:R079*ABF:I10',
        'NM1*PW*2',
        'N3*9 OAK AVE',
        'N4*SPRINGFIELD*IL*62702',
        'LX*1',
        'SV1*HC:A0998:GY*850*UN*1***1',
        'DTP*472*D8*20261001',
        'REF*6R*1'
      ]
    );
  });

  it('writes the admission date, prior authorization and note in implementation guide order', () => {
    const segs = build({
      ...mapped,
      admissionDate: '2026-09-28',
      priorAuthorization: 'PA-77',
      frequency: '7',
      payerClaimNumber: 'PCN123',
      note: 'BLS NON-EMERGENCY; 2 PATIENTS TRANSPORTED*'
    });
    const claim = segs.findIndex((s) => s.startsWith('CLM*'));
    assert.deepEqual(segs.slice(claim, claim + 5), [
      'CLM*c-1*942.5***41:B:7*Y*A*Y*Y',
      'DTP*435*D8*20260928',
      'REF*G1*PA-77',
      'REF*F8*PCN123',
      'NTE*ADD*BLS NON-EMERGENCY; 2 PATIENTS TRANSPORTED'
    ]);
  });

  it('writes no admission date, references or note when the claim has none', () => {
    assert.deepEqual(pick(build(mapped), 'DTP*435', 'REF*G1', 'REF*F8', 'NTE'), []);
  });

  it('writes a Medicare secondary payer type on the subscriber', () => {
    assert.deepEqual(
      pick(build({ ...mapped, payer: { ...mapped.payer, insuranceType: '12' } }), 'SBR'),
      ['SBR*P*18***12****MB']
    );
  });

  it('bills an original claim with frequency 1 and no payer claim number', () => {
    assert.deepEqual(pick(build(mapped), 'CLM', 'REF*F8'), ['CLM*c-1*942.5***41:B:1*Y*A*Y*Y']);
  });

  it('replaces an accepted claim with frequency 7 and the payer claim number', () => {
    assert.deepEqual(
      pick(build({ ...mapped, frequency: '7', payerClaimNumber: 'PCN123' }), 'CLM', 'REF*F8'),
      ['CLM*c-1*942.5***41:B:7*Y*A*Y*Y', 'REF*F8*PCN123']
    );
  });

  it('voids an accepted claim with frequency 8 and the payer claim number', () => {
    assert.deepEqual(
      pick(build({ ...mapped, frequency: '8', payerClaimNumber: 'PCN9' }), 'CLM', 'REF*F8'),
      ['CLM*c-1*942.5***41:B:8*Y*A*Y*Y', 'REF*F8*PCN9']
    );
  });

  it('certifies the benefits assignment as mapped', () => {
    assert.deepEqual(pick(build({ ...mapped, benefitsAssignment: 'W' }), 'CLM'), [
      'CLM*c-1*942.5***41:B:1*Y*A*W*Y'
    ]);
  });

  it('counts patients on a shared trip on each line, and none for one patient', () => {
    const shared = build({
      ...mapped,
      lines: mapped.lines.map((l) => ({ ...l, patientCount: 2 }))
    });
    assert.deepEqual(pick(shared, 'DTP*472', 'QTY'), [
      'DTP*472*D8*20261001',
      'QTY*PT*2',
      'DTP*472*D8*20261001',
      'QTY*PT*2'
    ]);
    assert.deepEqual(pick(build({ ...mapped, lines: [{ ...base, patientCount: 1 }] }), 'QTY'), []);
  });
});

describe('build837 prior payers', () => {
  it('carries a prior payer as a COB loop after the drop-off and before the lines', () => {
    const secondary = claimLoop({
      ...mapped,
      payer: { name: 'Blue Plan', payerId: 'DEMOBCBS', claimFiling: 'BL', insuranceType: null },
      otherPayers: [
        {
          ...MEDICARE_PRIOR,
          paidCents: 60_000,
          adjustedCents: 20_000,
          adjustments: [
            { group: 'CO', reason: '45', cents: 20_000 },
            { group: 'PR', reason: '2', cents: 14_250 }
          ]
        }
      ]
    });
    assert.deepEqual(secondary, [
      'HL*2*1*22*0',
      'SBR*S*18*******BL',
      "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73",
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD*IL*62702',
      'DMG*D8*19500203*M',
      'NM1*PR*2*BLUE PLAN*****PI*DEMOBCBS',
      'CLM*c-1*942.5***41:B:1*Y*A*Y*Y',
      'CR1****A*DH*7.4',
      'CRC*07*Y*09*06',
      'HI*ABK:R079*ABF:I10',
      'NM1*PW*2',
      'N3*9 OAK AVE',
      'N4*SPRINGFIELD*IL*62702',
      'NM1*45*2*MERCY HOSPITAL',
      'N3*100 HEALTH WAY',
      'N4*SPRINGFIELD*IL*62702',
      'SBR*P*18*******MB',
      'CAS*CO*45*200',
      'CAS*PR*2*142.5',
      'AMT*D*600',
      'OI***Y*P**Y',
      "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73",
      'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
      'DTP*573*D8*20261020',
      'LX*1',
      'SV1*HC:A0427:RH*850*UN*1***1',
      'DTP*472*D8*20261001',
      'REF*6R*1',
      'LX*2',
      'SV1*HC:A0425:RH*92.5*UN*7.4***1',
      'DTP*472*D8*20261001',
      'REF*6R*2'
    ]);
  });

  it('writes the reason codes a prior payer gave, grouped and six to a CAS segment', () => {
    const reasons = Array.from({ length: 7 }, (_, i) => ({
      group: 'CO' as const,
      reason: String(i + 1),
      cents: 100
    }));
    const secondary = build({
      ...mapped,
      otherPayers: [
        {
          ...MEDICARE_PRIOR,
          paidCents: 0,
          adjustedCents: 700,
          adjustments: [...reasons, { group: 'PR', reason: '1', cents: 25_000 }]
        }
      ]
    });
    assert.deepEqual(pick(secondary, 'CAS'), [
      'CAS*CO*1*1**2*1**3*1**4*1**5*1**6*1',
      'CAS*CO*7*1',
      'CAS*PR*1*250'
    ]);
  });

  it('reports how the prior payer adjudicated each line in 2430 and nothing left in 2320', () => {
    const segs = build(readX837Claim({ ...mapped, otherPayers: [lineAdjudicated] }));
    const cob = segs.findIndex((s) => s.startsWith('SBR*P'));
    assert.deepEqual(segs.slice(cob, cob + 2), ['SBR*P*18*******MB', 'AMT*D*612.35']);
    const lines = segs.findIndex((s) => s.startsWith('LX*1'));
    assert.deepEqual(segs.slice(lines, -3), [
      'LX*1',
      'SV1*HC:A0427:RH*850*UN*1***1',
      'DTP*472*D8*20261001',
      'REF*6R*1',
      'SVD*DEMOMCR*552.2*HC:A0427:RH**1',
      'CAS*CO*45*159.95',
      'CAS*PR*1*100**2*37.85',
      'DTP*573*D8*20261020',
      'LX*2',
      'SV1*HC:A0425:RH*92.5*UN*7.4***1',
      'DTP*472*D8*20261001',
      'REF*6R*2',
      'SVD*DEMOMCR*60.15*HC:A0425:RH**7.4',
      'CAS*PR*2*15.24',
      'CAS*CO*45*17.11',
      'DTP*573*D8*20261020'
    ]);
  });

  it('reports claim-level reason codes the lines do not account for in 2320', () => {
    const read = readX837Claim({
      ...mapped,
      otherPayers: [
        {
          ...lineAdjudicated,
          paidCents: 60_735,
          adjustedCents: 18_206,
          adjustments: [...lineAdjudicated.adjustments, { group: 'CO', reason: '253', cents: 500 }]
        }
      ]
    });
    const segs = build(read);
    const cob = segs.findIndex((s) => s.startsWith('SBR*P'));
    assert.deepEqual(segs.slice(cob, cob + 3), [
      'SBR*P*18*******MB',
      'CAS*CO*253*5',
      'AMT*D*607.35'
    ]);
    assert.deepEqual(pick(segs, 'SVD'), [
      'SVD*DEMOMCR*552.2*HC:A0427:RH**1',
      'SVD*DEMOMCR*60.15*HC:A0425:RH**7.4'
    ]);
  });
});

describe('readX837Claim', () => {
  it('reads a mapped claim back unchanged', () => {
    assert.deepEqual(readX837Claim(JSON.parse(JSON.stringify(mapped))), mapped);
  });

  it('names what a claim is missing', () => {
    for (const [patch, message] of [
      [{ lines: [] }, 'The 837P claim needs at least one service line'],
      [{ diagnoses: [] }, 'The 837P claim needs at least one diagnosis'],
      [{ payer: { ...mapped.payer, payerId: ' ' } }, 'The 837P claim needs a payer ID'],
      [{ claimId: '' }, 'The 837P claim needs a claim ID'],
      [{ frequency: null }, 'The 837P claim needs a claim frequency'],
      [
        { benefitsAssignment: '' },
        'The 837P claim needs a benefits assignment certification (CLM08)'
      ],
      [
        { patient: { ...mapped.patient, birthDate: null } },
        'The 837P claim needs a patient birth date'
      ],
      [
        { subscriber: { ...mapped.subscriber, relationship: '01', lastName: null } },
        'The 837P claim needs the last name of the insured on the subscriber'
      ],
      [
        { loadedMiles: 3, transportReason: null },
        'The 837P claim needs a transport reason with loaded miles'
      ],
      [{ loadedMiles: -2 }, 'The 837P claim needs loaded miles']
    ] as const) {
      assert.throws(() => readX837Claim({ ...mapped, ...patch }), { message }, message);
    }
  });

  it('names what a service line is missing', () => {
    for (const [line, message] of [
      [{ chargeCents: 1.5 }, 'Service line 1 needs a charge in cents'],
      [{ chargeCents: -1 }, 'Service line 1 needs a charge in cents'],
      [{ code: ' ' }, 'The 837P claim needs a code on service line 1'],
      [{ units: 0 }, 'The 837P claim needs units on service line 1'],
      [{ serviceDate: '' }, 'The 837P claim needs a date on service line 1']
    ] as const) {
      assert.throws(
        () => readX837Claim({ ...mapped, lines: [{ ...base, ...line }] }),
        { message },
        message
      );
    }
  });

  it('needs the payer claim number a replacement or void replaces, trimmed', () => {
    for (const frequency of ['7', '8']) {
      assert.throws(() => readX837Claim({ ...mapped, frequency, payerClaimNumber: ' ' }), {
        message: `The 837P claim needs the payer claim number frequency ${frequency} replaces`
      });
    }
    assert.equal(
      readX837Claim({ ...mapped, frequency: '7', payerClaimNumber: ' PCN123 ' }).payerClaimNumber,
      'PCN123'
    );
  });

  it('names a self subscriber after the patient when the map leaves the name blank', () => {
    const read = readX837Claim({
      ...mapped,
      subscriber: { ...mapped.subscriber, lastName: null, firstName: null }
    });
    assert.deepEqual(read.subscriber, {
      relationship: '18',
      lastName: "O'Brien~*",
      firstName: 'José',
      memberId: '1EG4TE5MK73',
      groupId: null
    });
  });

  it('keeps units as billed and caps diagnoses at twelve', () => {
    const diagnoses = Array.from({ length: 14 }, (_, i) => `R${String(i).padStart(2, '0')}`);
    const read = readX837Claim({ ...mapped, diagnoses, lines: [{ ...base, units: 1.1 }] });
    assert.equal(read.lines[0]?.units, 1.1);
    assert.deepEqual(read.diagnoses, diagnoses.slice(0, 12));
  });

  it('keeps four non-blank modifiers and five condition codes, and reports an unknown sex as U', () => {
    const read = readX837Claim({
      ...mapped,
      patient: { ...mapped.patient, sex: ' ' },
      conditionCodes: ['01', '04', '05', '06', '07', '09'],
      lines: [{ ...base, modifiers: ['RH', 'GA', '', 'QM', 'GY', 'QN'] }]
    });
    assert.deepEqual(
      [read.lines[0]?.modifiers, read.conditionCodes, read.patient.sex],
      [['RH', 'GA', 'QM', 'GY'], ['01', '04', '05', '06', '07'], 'U']
    );
  });

  it('keeps only a whole, positive patient weight', () => {
    const weight = (weightPounds: unknown) =>
      readX837Claim({ ...mapped, weightPounds }).weightPounds;
    assert.deepEqual([0, -5, 180.5, '180', Number.NaN, null, 1].map(weight), [
      null,
      null,
      null,
      null,
      null,
      null,
      1
    ]);
  });

  it('counts patients only from a whole number above zero', () => {
    const count = (patientCount: unknown) =>
      readX837Claim({ ...mapped, lines: [{ ...base, patientCount }] }).lines[0]?.patientCount;
    assert.deepEqual([0, -1, 2.5, '2', 3].map(count), [null, null, null, null, 3]);
  });

  it('drops the transport reason of a claim without loaded miles', () => {
    assert.equal(readX837Claim({ ...mapped, loadedMiles: null }).transportReason, null);
  });
});

describe('readX837Claim prior payers', () => {
  const prior = {
    name: 'Medicare',
    payerId: 'DEMOMCR',
    claimFiling: 'MB',
    memberId: '1EG4TE5MK73',
    relationship: '18',
    paidCents: 84_150,
    adjustedCents: 0,
    paidOn: '2026-10-20',
    adjustments: [
      { group: 'CO', reason: '45', cents: 10_100 },
      { group: 'XX', reason: '1', cents: 5 },
      { group: 'PR', reason: '1', cents: 0 }
    ]
  };

  it('reads a prior payer, naming a self insured after the patient and dropping unknown groups and zero amounts', () => {
    assert.deepEqual(readX837Claim({ ...mapped, otherPayers: [prior] }).otherPayers, [
      {
        name: 'Medicare',
        payerId: 'DEMOMCR',
        claimFiling: 'MB',
        memberId: '1EG4TE5MK73',
        groupId: null,
        relationship: '18',
        lastName: "O'Brien~*",
        firstName: 'José',
        paidCents: 84150,
        adjustedCents: 0,
        adjustments: [{ group: 'CO', reason: '45', cents: 10_100 }],
        lines: [],
        paidOn: '2026-10-20'
      }
    ]);
  });

  it('names what a prior payer is missing', () => {
    for (const [patch, message] of [
      [{ paidCents: 1.5 }, 'The 837P claim needs the amount other payer 1 paid in cents'],
      [{ paidOn: null }, 'The 837P claim needs the date other payer 1 adjudicated it'],
      [{ memberId: '' }, 'The 837P claim needs a member ID on other payer 1']
    ] as const) {
      assert.throws(
        () => readX837Claim({ ...mapped, otherPayers: [{ ...prior, ...patch }] }),
        { message },
        message
      );
    }
  });

  it('needs the reason codes of every prior payer', () => {
    assert.throws(
      () => readX837Claim({ ...mapped, otherPayers: [{ ...prior, adjustments: [] }] }),
      {
        message:
          'The 837P claim needs the reason codes (CAS) of other payer 1 (Medicare); post its remittance with them'
      }
    );
  });

  it('needs every prior payer to balance against the charges', () => {
    assert.throws(
      () =>
        readX837Claim({
          ...mapped,
          lines: [{ ...base, chargeCents: 90_000 }, ...mapped.lines.slice(1)],
          otherPayers: [prior]
        }),
      {
        message:
          'The 837P claim needs other payer 1 (Medicare) to balance: its payment and reason codes add up to $942.50, not the $992.50 charged (CLM02 = AMT*D + 2320 CAS + 2430 CAS), so the charges changed after it adjudicated the claim or its remittance was posted in part'
      }
    );
  });

  it('carries at most ten prior payers', () => {
    assert.throws(
      () => readX837Claim({ ...mapped, otherPayers: Array.from({ length: 11 }, () => prior) }),
      { message: 'The 837P claim carries at most 11 payers' }
    );
    assert.equal(
      readX837Claim({ ...mapped, otherPayers: Array.from({ length: 10 }, () => prior) }).otherPayers
        .length,
      10
    );
  });

  it('keeps line adjudications only when every billed line is answered once and balances', () => {
    const lines = (adjudicated: unknown[]) =>
      readX837Claim({ ...mapped, otherPayers: [{ ...lineAdjudicated, lines: adjudicated }] })
        .otherPayers[0];
    assert.deepEqual(
      lines(ADJUDICATED_LINES)?.lines.map((l) => l.line),
      [1, 2]
    );
    const partial = lines(ADJUDICATED_LINES.slice(0, 1));
    assert.deepEqual([partial?.lines, partial?.adjustments.length], [[], 3]);
    const unbalanced = lines(ADJUDICATED_LINES.map((l) => ({ ...l, paidCents: l.paidCents + 1 })));
    assert.deepEqual(unbalanced?.lines, []);
    const twice = lines([...ADJUDICATED_LINES, ADJUDICATED_LINES[0]]);
    assert.deepEqual([twice?.lines, twice?.adjustments.length], [[], 3]);
  });

  it('skips adjudicated lines without a code, a whole line number or positive units', () => {
    const read = readX837Claim({
      ...mapped,
      otherPayers: [
        {
          ...lineAdjudicated,
          lines: [
            ...ADJUDICATED_LINES,
            { line: 3, code: '', paidCents: 0, units: 1, adjustments: [] },
            { line: 1.5, code: 'A0427', paidCents: 0, units: 1, adjustments: [] },
            { line: 1, code: 'A0427', paidCents: 0, units: -1, adjustments: [] }
          ]
        }
      ]
    });
    assert.deepEqual(
      read.otherPayers[0]?.lines.map((l) => l.line),
      [1, 2]
    );
    assert.deepEqual(read.otherPayers[0]?.adjustments, []);
  });
});

describe('submitterIssues', () => {
  it('finds nothing wrong with a complete billing profile', () => {
    assert.deepEqual(submitterIssues(submitter), []);
  });

  it('asks for a billing profile when there is none', () => {
    assert.deepEqual(submitterIssues(null), ['Add a billing profile in Settings']);
  });

  it('needs a valid NPI, a ZIP+4 and both clearinghouse IDs', () => {
    assert.deepEqual(submitterIssues({ ...submitter, npi: '1234567890' }), [
      'The billing NPI is invalid'
    ]);
    assert.deepEqual(submitterIssues({ ...submitter, postalCode: '62701' }), [
      'The billing ZIP code needs all 9 digits (ZIP+4) in Settings'
    ]);
    assert.deepEqual(submitterIssues({ ...submitter, submitterId: null }), [
      'Add the clearinghouse submitter ID in Settings'
    ]);
    assert.deepEqual(submitterIssues({ ...submitter, receiverId: null }), [
      'Add the clearinghouse receiver ID in Settings'
    ]);
  });

  it('lists every issue in order', () => {
    assert.deepEqual(
      submitterIssues({
        ...submitter,
        npi: '1234567890',
        postalCode: '627011',
        submitterId: '',
        receiverId: ''
      }),
      [
        'The billing NPI is invalid',
        'The billing ZIP code needs all 9 digits (ZIP+4) in Settings',
        'Add the clearinghouse submitter ID in Settings',
        'Add the clearinghouse receiver ID in Settings'
      ]
    );
  });
});
