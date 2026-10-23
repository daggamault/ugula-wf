import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type BatchClaim, build837, claimIssues, type Submitter, submitterIssues } from './x837.ts';

const submitter: Submitter = {
  organizationName: 'Metro EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  phone: '2175550100',
  submitterId: 'SUB01',
  receiverId: 'RCV01',
  receiverName: 'Demo Clearinghouse',
  production: false
};

const place = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

const claim: BatchClaim = {
  claimId: 'c-1',
  priorPayers: [],
  payer: { name: 'Medicare', payerId: 'DEMOMCR', claimFiling: 'MB' },
  memberId: '1EG4TE5MK73',
  groupId: null,
  patient: {
    firstName: 'José',
    lastName: "O'Brien~*",
    birthDate: '1950-02-03',
    sex: 'M',
    ...place
  },
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, ...place },
    destination: { name: 'Mercy Hospital', ...place, addressLine: '100 Health Way' },
    diagnoses: ['R079', 'I10'],
    originDestination: 'RH'
  },
  emergency: true,
  loadedMiles: 7.33,
  lines: [
    { code: 'A0427', units: 1, unitCents: 85_000, totalCents: 85_000 },
    { code: 'A0425', units: 7.33, unitCents: 1_250, totalCents: 9_163 }
  ]
};

const envelope = { controlNumber: 42, createdAt: new Date('2026-10-23T14:05:09Z') };

const segments = (text: string) =>
  text
    .trim()
    .split('~\n')
    .map((s) => s.replace(/~$/, ''));

describe('build837', () => {
  const file = build837(submitter, [claim, { ...claim, claimId: 'c-2' }], envelope);
  const segs = segments(file);
  const find = (id: string) => segs.filter((s) => s.startsWith(`${id}*`));

  it('wraps one transaction in a fixed-width ISA envelope with matching control numbers', () => {
    const isa = segs[0] ?? '';
    assert.equal(isa.length, 105);
    assert.equal(isa.split('*')[13], '000000042');
    assert.equal(isa.split('*')[15], 'T');
    assert.equal(segs.at(-1), 'IEA*1*000000042');
    assert.equal(segs.at(-2), 'GE*1*42');
    assert.equal(find('GS')[0], 'GS*HC*SUB01*RCV01*20261023*1405*42*X*005010X222A1');
    const st = segs.findIndex((s) => s.startsWith('ST*'));
    assert.equal(segs.at(-3), `SE*${segs.length - 2 - st}*0001`);
    assert.ok(file.endsWith('~\n'));
  });

  it('bills each claim under one billing provider with balanced charges', () => {
    assert.deepEqual(
      find('HL').map((s) => s),
      ['HL*1**20*1', 'HL*2*1*22*0', 'HL*3*1*22*0']
    );
    assert.equal(
      find('NM1').find((s) => s.startsWith('NM1*85')),
      'NM1*85*2*METRO EMS*****XX*1234567893'
    );
    assert.deepEqual(
      find('CLM').map((s) => s.split('*')[2]),
      ['941.63', '941.63']
    );
    assert.equal(find('SV1')[1], 'SV1*HC:A0425:RH*91.63*UN*7.4***1');
    assert.equal(find('CR1')[0], 'CR1****A*DH*7.4');
    assert.equal(find('CRC')[0], 'CRC*07*Y*09*06');
    assert.equal(find('HI')[0], 'HI*ABK:R079*ABF:I10');
    assert.equal(find('DTP')[0], 'DTP*472*D8*20261001');
  });

  it('strips delimiters and accents from free text', () => {
    assert.equal(
      find('NM1').find((s) => s.startsWith('NM1*IL')),
      "NM1*IL*1*O'BRIEN*JOSE****MI*1EG4TE5MK73"
    );
    assert.ok(!segs.some((s) => s.split('*').some((el) => el.includes('~'))));
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

  it('leaves out the emergency condition for scheduled transports', () => {
    const scheduled = segments(build837(submitter, [{ ...claim, emergency: false }], envelope));
    assert.ok(scheduled.includes('CRC*07*Y*09'));
  });

  it('refuses control numbers that do not fit the envelope', () => {
    assert.throws(
      () => build837(submitter, [claim], { ...envelope, controlNumber: 1e9 }),
      /out of range/
    );
    assert.throws(
      () => build837(submitter, [claim], { ...envelope, controlNumber: 0 }),
      /out of range/
    );
  });
});

describe('claimIssues', () => {
  it('passes a complete primary claim', () => {
    assert.deepEqual(claimIssues(claim), []);
  });

  it('lists everything a biller must fix before the claim can go out', () => {
    const blank = { name: null, addressLine: null, city: null, state: null, postalCode: null };
    const issues = claimIssues({
      ...claim,
      priorPayers: ['Medicare'],
      payer: { name: 'Blue Plan', payerId: null, claimFiling: null },
      memberId: null,
      details: {
        serviceDate: null,
        pickup: blank,
        destination: blank,
        diagnoses: [],
        originDestination: null
      },
      loadedMiles: null,
      lines: []
    });
    assert.ok(issues[0]?.includes('secondary payer'));
    assert.ok(issues.includes('Blue Plan is not in the payer directory'));
    assert.ok(issues.includes('The member ID for Blue Plan is missing'));
    assert.ok(issues.includes('Pickup ZIP code is missing'));
    assert.ok(issues.includes('Drop-off street address is missing'));
    assert.ok(issues.includes('The origin/destination modifier is missing'));
    assert.ok(issues.includes('Loaded miles are missing'));
    assert.ok(issues.includes('The claim has no service lines'));
  });
});

describe('submitterIssues', () => {
  it('needs a billing profile with clearinghouse IDs', () => {
    assert.deepEqual(submitterIssues(submitter), []);
    assert.deepEqual(submitterIssues(null), ['Add a billing profile in Settings']);
    assert.deepEqual(submitterIssues({ ...submitter, npi: '1234567890', submitterId: null }), [
      'The billing NPI is invalid',
      'Add the clearinghouse submitter ID in Settings'
    ]);
  });
});
