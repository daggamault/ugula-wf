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
      payer: { name: 'Blue Plan', payerId: 'DEMOBCBS', claimFiling: 'BL' },
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
          adjustments: []
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
          adjustments: [...reasons, { group: 'PR', reason: '1', cents: 25_000 }]
        }
      ]
    });
    assert.deepEqual(
      secondary.filter((s) => s.startsWith('CAS')),
      ['CAS*CO*1*1**2*1**3*1**4*1**5*1**6*1', 'CAS*CO*7*1', 'CAS*PR*1*250']
    );
  });

  it('replaces an accepted claim with frequency 7 and the payer claim number', () => {
    const replaced = build({ ...mapped, frequency: '7', payerClaimNumber: 'PCN123' });
    assert.ok(replaced.some((s) => s.startsWith('CLM*c-1*942.5***41:B:7*')));
    assert.ok(replaced.includes('REF*F8*PCN123'));
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

  it('rounds units up to tenths and caps diagnoses at twelve', () => {
    const read = readX837Claim({
      ...mapped,
      diagnoses: Array.from({ length: 14 }, (_, i) => `R${String(i).padStart(2, '0')}`),
      lines: [{ ...base, units: 1.01 }]
    });
    assert.equal(read.lines[0]?.units, 1.1);
    assert.equal(read.diagnoses.length, 12);
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
  });
});
