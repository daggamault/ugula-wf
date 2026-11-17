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

describe('build837', () => {
  const file = build837(submitter, [mapped, { ...mapped, claimId: 'c-2' }], envelope);
  const segs = segments(file);
  const find = (id: string) => segs.filter((s) => s.startsWith(`${id}*`));

  it('wraps one transaction in a fixed-width ISA envelope with matching control numbers', () => {
    const isa = segs[0] ?? '';
    assert.equal(isa.length, 105);
    assert.equal(isa.split('*')[13], '000000042');
    assert.equal(isa.split('*')[15], 'T');
    assert.ok(isa.endsWith('*^*00501*000000042*0*T*:'));
    assert.equal(segs.at(-1), 'IEA*1*000000042');
    assert.equal(segs.at(-2), 'GE*1*42');
    assert.equal(find('GS')[0], 'GS*HC*SUB01*RCV01*20261023*1405*42*X*005010X222A1');
    const st = segs.findIndex((s) => s.startsWith('ST*'));
    assert.equal(segs.at(-3), `SE*${segs.length - 2 - st}*0001`);
    assert.ok(file.endsWith('~\n'));
  });

  it('bills each claim under one billing provider with balanced charges', () => {
    assert.deepEqual(find('HL'), ['HL*1**20*1', 'HL*2*1*22*0', 'HL*3*1*22*0']);
    assert.equal(
      find('NM1').find((s) => s.startsWith('NM1*85')),
      'NM1*85*2*METRO EMS*****XX*1234567893'
    );
    assert.equal(find('N4')[0], 'N4*SPRINGFIELD*IL*627011234');
    assert.deepEqual(
      find('CLM').map((s) => s.split('*')[2]),
      ['942.5', '942.5']
    );
    assert.equal(find('SBR')[0], 'SBR*P*18*******MB');
    assert.equal(find('SV1')[1], 'SV1*HC:A0425:RH*92.5*UN*7.4***1');
    assert.equal(find('CR1')[0], 'CR1****A*DH*7.4');
    assert.equal(find('CRC')[0], 'CRC*07*Y*09*06');
    assert.equal(find('HI')[0], 'HI*ABK:R079*ABF:I10');
    assert.equal(find('DTP')[0], 'DTP*472*D8*20261001');
    assert.ok(!segs.some((s) => s.startsWith('REF*F8')));
  });

  it('strips delimiters and accents from free text', () => {
    assert.equal(
      find('NM1').find((s) => s.startsWith('NM1*IL')),
      "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73"
    );
    assert.ok(!segs.some((s) => s.split('*').some((el) => el.includes('~'))));
  });

  it('strips separators from every mapped value, codes included', () => {
    const tainted = build({
      ...mapped,
      claimId: 'c~1*2',
      frequency: '1:7',
      patient: { ...mapped.patient, sex: 'M*X' },
      lines: [{ ...base, code: 'A04^27', modifiers: ['R:H'] }]
    });
    assert.ok(tainted.includes('CLM*c 1 2*850***41:B:1 7*Y*A*Y*Y'));
    assert.ok(tainted.includes('DMG*D8*19500203*M X'));
    assert.ok(tainted.includes('SV1*HC:A04 27:R H*850*UN*1***1'));
  });

  it('names pickup and drop-off locations', () => {
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

  it('writes the ambulance conditions it is given, and none when there are none', () => {
    assert.ok(build({ ...mapped, conditionCodes: ['09'] }).includes('CRC*07*Y*09'));
    assert.ok(!build({ ...mapped, conditionCodes: [] }).some((s) => s.startsWith('CRC*')));
  });

  it('writes the patient weight and a prior authorization when the report has them', () => {
    const documented = build({ ...mapped, weightPounds: 180, priorAuthorization: 'PA-77' });
    assert.ok(documented.includes('CR1*LB*180**A*DH*7.4'));
    assert.ok(documented.includes('REF*G1*PA-77'));
  });

  it('writes treat-no-transport claims without CR1 or a drop-off', () => {
    const noTransport = build({
      ...mapped,
      loadedMiles: null,
      transportReason: null,
      lines: [{ ...base, code: 'A0998', modifiers: ['GY'] }]
    });
    assert.ok(!noTransport.some((s) => s.startsWith('CR1*') || s.startsWith('NM1*45')));
    assert.ok(noTransport.includes('NM1*PW*2'));
    assert.ok(noTransport.includes('SV1*HC:A0998:GY*850*UN*1***1'));
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
    assert.deepEqual(
      dependent.filter((s) => s.startsWith('HL*')),
      ['HL*1**20*1', 'HL*2*1*22*1', 'HL*3*2*23*0', 'HL*4*1*22*0']
    );
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

  it('carries prior payers as COB loops, so the next payer is billed in order', () => {
    const secondary = build({
      ...mapped,
      payer: { name: 'Blue Plan', payerId: 'DEMOBCBS', claimFiling: 'BL', insuranceType: null },
      otherPayers: [
        {
          name: 'Medicare',
          payerId: 'DEMOMCR',
          claimFiling: 'MB',
          memberId: '1EG4TE5MK73',
          groupId: null,
          relationship: '18',
          lastName: "O'Brien",
          firstName: 'José',
          paidCents: 60_000,
          adjustedCents: 20_000,
          paidOn: '2026-10-20',
          adjustments: [
            { group: 'CO', reason: '45', cents: 20_000 },
            { group: 'PR', reason: '2', cents: 14_250 }
          ],
          lines: []
        }
      ]
    });
    assert.ok(secondary.includes('SBR*S*18*******BL'));
    const at = secondary.findIndex((s) => s.startsWith('SBR*P'));
    assert.deepEqual(secondary.slice(at, at + 8), [
      'SBR*P*18*******MB',
      'CAS*CO*45*200',
      'CAS*PR*2*142.5',
      'AMT*D*600',
      'OI***Y*P**Y',
      "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73",
      'NM1*PR*2*MEDICARE*****PI*DEMOMCR',
      'DTP*573*D8*20261020'
    ]);
    assert.ok(at > secondary.findIndex((s) => s.startsWith('NM1*45')));
    assert.ok(at < secondary.findIndex((s) => s.startsWith('LX*')));
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
          name: 'Medicare',
          payerId: 'DEMOMCR',
          claimFiling: 'MB',
          memberId: '1EG4TE5MK73',
          groupId: null,
          relationship: '18',
          lastName: "O'Brien",
          firstName: 'José',
          paidCents: 0,
          adjustedCents: 700,
          paidOn: '2026-10-20',
          adjustments: [...reasons, { group: 'PR', reason: '1', cents: 25_000 }],
          lines: []
        }
      ]
    });
    assert.deepEqual(
      secondary.filter((s) => s.startsWith('CAS')),
      ['CAS*CO*1*1**2*1**3*1**4*1**5*1**6*1', 'CAS*CO*7*1', 'CAS*PR*1*250']
    );
  });

  it('reports how the prior payer adjudicated each line in 2430 and the rest in 2320', () => {
    const medicare = {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: '1EG4TE5MK73',
      relationship: '18',
      lastName: 'Doe',
      paidCents: 61_235,
      adjustedCents: 17_706,
      paidOn: '2026-10-20',
      adjustments: [
        { group: 'CO', reason: '45', cents: 17_706 },
        { group: 'PR', reason: '1', cents: 10_000 },
        { group: 'PR', reason: '2', cents: 5309 }
      ],
      lines: [
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
      ]
    };
    const segs = build(readX837Claim({ ...mapped, otherPayers: [medicare] }));
    const cob = segs.slice(segs.findIndex((s) => s.startsWith('SBR*P')));
    assert.deepEqual(cob.slice(0, 2), ['SBR*P*18*******MB', 'AMT*D*612.35']);
    const lines = segs.slice(segs.findIndex((s) => s.startsWith('LX*1')));
    assert.deepEqual(lines, [
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
      'DTP*573*D8*20261020',
      ...lines.slice(16)
    ]);
    assert.ok(lines[16]?.startsWith('SE*'));
    const partial = readX837Claim({
      ...mapped,
      otherPayers: [{ ...medicare, lines: medicare.lines.slice(0, 1) }]
    });
    assert.deepEqual(partial.otherPayers[0]?.lines, []);
    assert.equal(partial.otherPayers[0]?.adjustments.length, 3);
    assert.ok(!build(partial).some((s) => s.startsWith('SVD')));
    const unbalanced = readX837Claim({
      ...mapped,
      otherPayers: [
        { ...medicare, lines: medicare.lines.map((l) => ({ ...l, paidCents: l.paidCents + 1 })) }
      ]
    });
    assert.deepEqual(unbalanced.otherPayers[0]?.lines, []);
  });

  it('reports claim-level reason codes the lines do not account for in 2320', () => {
    const medicare = {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: '1EG4TE5MK73',
      relationship: '18',
      paidCents: 60_735,
      adjustedCents: 18_206,
      paidOn: '2026-10-20',
      adjustments: [
        { group: 'CO', reason: '45', cents: 17_706 },
        { group: 'CO', reason: '253', cents: 500 },
        { group: 'PR', reason: '1', cents: 10_000 },
        { group: 'PR', reason: '2', cents: 5309 }
      ],
      lines: [
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
        },
        { line: 3, code: '', paidCents: 0, units: 1, adjustments: [] },
        { line: 1.5, code: 'A0427', paidCents: 0, units: 1, adjustments: [] },
        { line: 1, code: 'A0427', paidCents: 0, units: -1, adjustments: [] }
      ]
    };
    const read = readX837Claim({ ...mapped, otherPayers: [medicare] });
    assert.deepEqual(read.otherPayers[0]?.adjustments, [
      { group: 'CO', reason: '253', cents: 500 }
    ]);
    assert.deepEqual(
      read.otherPayers[0]?.lines.map((l) => l.line),
      [1, 2]
    );
    const segs = build(read);
    const cob = segs.slice(segs.findIndex((s) => s.startsWith('SBR*P')));
    assert.deepEqual(cob.slice(0, 3), ['SBR*P*18*******MB', 'CAS*CO*253*5', 'AMT*D*607.35']);
    assert.equal(segs.filter((s) => s.startsWith('SVD*')).length, 2);
    const twice = readX837Claim({
      ...mapped,
      otherPayers: [{ ...medicare, lines: [...medicare.lines.slice(0, 2), medicare.lines[0]] }]
    });
    assert.deepEqual(twice.otherPayers[0]?.lines, []);
    assert.equal(twice.otherPayers[0]?.adjustments.length, 4);
  });

  it('leaves the state and ZIP code empty on N4 when an address has none', () => {
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

  it('names the receiver by its ID when the billing profile has no receiver name', () => {
    for (const receiverName of [null, '', ' ~ ']) {
      assert.ok(
        segments(build837({ ...submitter, receiverName }, [mapped], envelope)).includes(
          'NM1*40*2*RCV01*****46*RCV01'
        )
      );
    }
  });

  it('writes no REF*F8 on an original claim without a payer claim number', () => {
    const original = build({ ...mapped, frequency: '1', payerClaimNumber: null });
    assert.ok(original.some((s) => s.startsWith('CLM*c-1*942.5***41:B:1*Y*A*Y*Y')));
    assert.ok(!original.some((s) => s.startsWith('REF*F8')));
    assert.throws(
      () => readX837Claim({ ...mapped, frequency: '8', payerClaimNumber: ' ' }),
      /^Error: The 837P claim needs the payer claim number frequency 8 replaces$/
    );
    assert.equal(
      readX837Claim({ ...mapped, frequency: '7', payerClaimNumber: ' PCN123 ' }).payerClaimNumber,
      'PCN123'
    );
  });

  it('replaces an accepted claim with frequency 7 and the payer claim number', () => {
    const replaced = build({ ...mapped, frequency: '7', payerClaimNumber: 'PCN123' });
    assert.ok(replaced.some((s) => s.startsWith('CLM*c-1*942.5***41:B:7*')));
    assert.ok(replaced.includes('REF*F8*PCN123'));
  });

  it('voids an accepted claim with frequency 8 and the payer claim number', () => {
    const voided = build({ ...mapped, frequency: '8', payerClaimNumber: 'PCN9' });
    assert.ok(voided.some((s) => s.startsWith('CLM*c-1*942.5***41:B:8*Y*A*Y*Y')));
    assert.ok(voided.includes('REF*F8*PCN9'));
  });

  it('certifies the benefits assignment as mapped and counts patients on a shared trip', () => {
    const refused = build({ ...mapped, benefitsAssignment: 'W' });
    assert.ok(refused.some((s) => s.startsWith('CLM*c-1*942.5***41:B:1*Y*A*W*Y')));
    const shared = build({
      ...mapped,
      lines: mapped.lines.map((l) => ({ ...l, patientCount: 2 }))
    });
    assert.deepEqual(
      shared.filter((s) => s.startsWith('DTP*472') || s.startsWith('QTY')),
      ['DTP*472*D8*20261001', 'QTY*PT*2', 'DTP*472*D8*20261001', 'QTY*PT*2']
    );
    const single = build({ ...mapped, lines: [{ ...base, patientCount: 1 }] });
    assert.ok(!single.some((s) => s.startsWith('QTY')));
    assert.throws(
      () => readX837Claim({ ...mapped, benefitsAssignment: '' }),
      /benefits assignment certification \(CLM08\)/
    );
    assert.deepEqual(
      readX837Claim({ ...mapped, lines: [{ ...base, patientCount: 3 }] }).lines[0]?.patientCount,
      3
    );
  });

  it('writes 2300 references in implementation guide order, prior authorization first', () => {
    const refs = build({
      ...mapped,
      frequency: '7',
      payerClaimNumber: 'PCN123',
      priorAuthorization: 'PA-77'
    }).filter((s) => s.startsWith('REF*G1') || s.startsWith('REF*F8'));
    assert.deepEqual(refs, ['REF*G1*PA-77', 'REF*F8*PCN123']);
  });

  it('writes the admission date, the claim note and a Medicare secondary payer type', () => {
    const segs = build({
      ...mapped,
      admissionDate: '2026-09-28',
      priorAuthorization: 'PA-77',
      note: 'BLS NON-EMERGENCY; 2 PATIENTS TRANSPORTED*',
      payer: { ...mapped.payer, insuranceType: '12' }
    });
    const claim = segs.slice(segs.findIndex((s) => s.startsWith('CLM*')));
    assert.deepEqual(claim.slice(1, 4), [
      'DTP*435*D8*20260928',
      'REF*G1*PA-77',
      'NTE*ADD*BLS NON-EMERGENCY; 2 PATIENTS TRANSPORTED'
    ]);
    assert.ok(segs.includes('SBR*P*18***12****MB'));
    assert.ok(!build(mapped).some((s) => s.startsWith('NTE') || s.startsWith('DTP*435')));
    const long = build({ ...mapped, note: 'X'.repeat(90) }).find((s) => s.startsWith('NTE'));
    assert.equal(long, `NTE*ADD*${'X'.repeat(80)}`);
  });

  it('reports the loaded miles as billed, without rounding them again', () => {
    assert.ok(build({ ...mapped, loadedMiles: 121 }).includes('CR1****A*DH*121'));
    assert.ok(build({ ...mapped, loadedMiles: 12.3 }).includes('CR1****A*DH*12.3'));
  });

  it('counts SE01 across a batch of self and dependent claims', () => {
    const batch = build(
      mapped,
      { ...mapped, subscriber: { ...mapped.subscriber, relationship: '01', lastName: 'Doe' } },
      mapped
    );
    const st = batch.findIndex((s) => s.startsWith('ST*'));
    const se = batch.findIndex((s) => s.startsWith('SE*'));
    assert.equal(batch[se], `SE*${se - st + 1}*0001`);
    assert.deepEqual(
      batch.filter((s) => s.startsWith('HL*')),
      ['HL*1**20*1', 'HL*2*1*22*0', 'HL*3*1*22*1', 'HL*4*3*23*0', 'HL*5*1*22*0']
    );
    assert.equal(batch.filter((s) => s.startsWith('CLM*')).length, 3);
  });

  it('opens with the submitter, receiver and ambulance billing provider loops', () => {
    const at = segs.findIndex((s) => s.startsWith('BHT*'));
    assert.deepEqual(segs.slice(at, at + 11), [
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
      'HL*2*1*22*0'
    ]);
  });

  it('refuses control numbers that do not fit the envelope', () => {
    assert.throws(
      () => build837(submitter, [mapped], { ...envelope, controlNumber: 1e9 }),
      /out of range/
    );
    assert.throws(
      () => build837(submitter, [mapped], { ...envelope, controlNumber: 0 }),
      /out of range/
    );
  });
});

describe('readX837Claim', () => {
  it('reads mapped claims and names what is missing', () => {
    assert.deepEqual(readX837Claim(JSON.parse(JSON.stringify(mapped))), mapped);
    assert.throws(() => readX837Claim({ ...mapped, lines: [] }), /at least one service line/);
    assert.throws(
      () => readX837Claim({ ...mapped, payer: { ...mapped.payer, payerId: ' ' } }),
      /payer ID/
    );
    assert.throws(
      () => readX837Claim({ ...mapped, lines: [{ ...base, chargeCents: 1.5 }] }),
      /charge in cents/
    );
    assert.throws(() => readX837Claim({ ...mapped, diagnoses: [] }), /at least one diagnosis/);
    assert.throws(
      () => readX837Claim({ ...mapped, frequency: '7' }),
      /payer claim number frequency 7 replaces/
    );
    assert.throws(
      () =>
        readX837Claim({
          ...mapped,
          subscriber: { ...mapped.subscriber, relationship: '01', lastName: null }
        }),
      /last name of the insured on the subscriber/
    );
    assert.throws(
      () => readX837Claim({ ...mapped, loadedMiles: 3, transportReason: null }),
      /transport reason/
    );
  });

  it('names a self subscriber after the patient when the map leaves the name blank', () => {
    const read = readX837Claim({
      ...mapped,
      subscriber: { ...mapped.subscriber, lastName: null, firstName: null }
    });
    assert.equal(read.subscriber.lastName, "O'Brien~*");
    assert.equal(read.subscriber.firstName, 'José');
  });

  it('keeps units as billed and caps diagnoses at twelve', () => {
    const read = readX837Claim({
      ...mapped,
      diagnoses: Array.from({ length: 14 }, (_, i) => `R${String(i).padStart(2, '0')}`),
      lines: [{ ...base, units: 1.1 }]
    });
    assert.equal(read.lines[0]?.units, 1.1);
    assert.equal(read.diagnoses.length, 12);
  });

  it('keeps four modifiers and five condition codes, and reports an unknown sex as U', () => {
    const read = readX837Claim({
      ...mapped,
      patient: { ...mapped.patient, sex: ' ' },
      conditionCodes: ['01', '04', '05', '06', '07', '09'],
      lines: [{ ...base, modifiers: ['RH', 'GA', '', 'QM', 'GY', 'QN'] }],
      weightPounds: 180.5
    });
    assert.deepEqual(read.lines[0]?.modifiers, ['RH', 'GA', 'QM', 'GY']);
    assert.deepEqual(read.conditionCodes, ['01', '04', '05', '06', '07']);
    assert.equal(read.patient.sex, 'U');
    assert.equal(read.weightPounds, null);
  });

  it('keeps only a whole, positive patient weight', () => {
    const weight = (weightPounds: unknown) =>
      readX837Claim({ ...mapped, weightPounds }).weightPounds;
    assert.deepEqual([0, -5, '180', Number.NaN, null].map(weight), [null, null, null, null, null]);
    assert.equal(weight(1), 1);
    assert.ok(build({ ...mapped, weightPounds: null }).includes('CR1****A*DH*7.4'));
  });

  it('counts patients only from a whole number above zero', () => {
    const count = (patientCount: unknown) =>
      readX837Claim({ ...mapped, lines: [{ ...base, patientCount }] }).lines[0]?.patientCount;
    assert.deepEqual([0, -1, 2.5, '2'].map(count), [null, null, null, null]);
  });

  it('needs complete prior payers and at most ten of them', () => {
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
    const read = readX837Claim({ ...mapped, otherPayers: [prior] });
    assert.deepEqual(read.otherPayers[0]?.adjustments, [
      { group: 'CO', reason: '45', cents: 10_100 }
    ]);
    assert.throws(
      () => readX837Claim({ ...mapped, otherPayers: [{ ...prior, adjustments: [] }] }),
      /reason codes \(CAS\) of other payer 1 \(Medicare\)/
    );
    assert.throws(
      () =>
        readX837Claim({
          ...mapped,
          lines: [{ ...base, chargeCents: 90_000 }, ...mapped.lines.slice(1)],
          otherPayers: [prior]
        }),
      /add up to \$942\.50, not the \$992\.50 charged/
    );
    assert.equal(read.otherPayers[0]?.lastName, "O'Brien~*");
    assert.throws(
      () => readX837Claim({ ...mapped, otherPayers: [{ ...prior, paidCents: 1.5 }] }),
      /amount other payer 1 paid in cents/
    );
    assert.throws(
      () => readX837Claim({ ...mapped, otherPayers: [{ ...prior, paidOn: null }] }),
      /date other payer 1 adjudicated it/
    );
    assert.throws(
      () => readX837Claim({ ...mapped, otherPayers: Array.from({ length: 11 }, () => prior) }),
      /at most 11 payers/
    );
  });

  it('rejects lines without positive units or a date, and loaded miles that are not positive', () => {
    assert.throws(
      () => readX837Claim({ ...mapped, lines: [{ ...base, units: 0 }] }),
      /units on service line 1/
    );
    assert.throws(
      () => readX837Claim({ ...mapped, lines: [{ ...base, serviceDate: '' }] }),
      /a date on service line 1/
    );
    assert.throws(() => readX837Claim({ ...mapped, loadedMiles: -2 }), /loaded miles/);
    assert.equal(readX837Claim({ ...mapped, loadedMiles: null }).transportReason, null);
  });
});

describe('submitterIssues', () => {
  it('needs a billing profile with a ZIP+4 and clearinghouse IDs', () => {
    assert.deepEqual(submitterIssues(submitter), []);
    assert.deepEqual(submitterIssues(null), ['Add a billing profile in Settings']);
    assert.deepEqual(submitterIssues({ ...submitter, npi: '1234567890', submitterId: null }), [
      'The billing NPI is invalid',
      'Add the clearinghouse submitter ID in Settings'
    ]);
    assert.deepEqual(submitterIssues({ ...submitter, postalCode: '62701' }), [
      'The billing ZIP code needs all 9 digits (ZIP+4) in Settings'
    ]);
    assert.deepEqual(submitterIssues({ ...submitter, receiverId: null }), [
      'Add the clearinghouse receiver ID in Settings'
    ]);
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
