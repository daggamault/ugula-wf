import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  draftClaim,
  eventLogged,
  fileClaim,
  reviewed,
  step,
  uploadEncounters,
  work
} from './shared/claims.ts';
import { expectClaim, lineCodes } from './shared/expect.ts';
import { type Session, SUITE_MS, signIn, uniqueId } from './shared/session.ts';

const FIXTURES = [
  'als2-cardiac-arrest',
  'als1-iv-solutions',
  'als2-iv-medications',
  'sct-interfacility',
  'critical-care-scene',
  'long-distance-stale-pcs',
  'short-trip-self-pay'
] as const;

type Fixture = (typeof FIXTURES)[number];

let s: Session;
const pcrs = Object.fromEntries(FIXTURES.map((f) => [f, uniqueId('E2E-LEVEL')])) as Record<
  Fixture,
  string
>;

const built = async (fixture: Fixture) => reviewed(s, await draftClaim(s, pcrs[fixture]));

describe('the level of service follows what the report documents', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    for (const fixture of FIXTURES) await uploadEncounters(s, pcrs[fixture], fixture);
  });

  after(async () => {
    await s?.browser.close();
  });

  it('files a resuscitation with defibrillation, an IO line and intubation as ALS2', async () => {
    const c = await built('als2-cardiac-arrest');
    expectClaim(c, {
      classification: 'emergency',
      level: 'ALS2',
      emergency: true,
      lines: [
        ['A0433', 1],
        ['A0425', 5.4]
      ],
      originDestination: 'RH',
      payers: ['Medicare'],
      warnings: [/Not signed because the patient was unconscious/]
    });
    assert.equal(c.claim.signature, 'exception');
    const { file } = await fileClaim(s, c.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0433:RH', 'HC:A0425:RH']);
    assert.match(file, /CLM\*[^~]*\*41:B:1\*Y\*A\*Y\*Y~/);
  });

  it('files saline and dextrose as ALS1, not ALS2, to Medicaid', async () => {
    const c = await built('als1-iv-solutions');
    expectClaim(c, {
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 6.4]
      ],
      originDestination: 'EH',
      payers: ['Medicaid']
    });
    const { file } = await fileClaim(s, c.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0427:EH', 'HC:A0425:EH']);
    assert.match(file, /SBR\*P\*18\*[^*]*\*\*\*\*\*\*MC~/);
  });

  it('files three IV medication administrations, by push or pump, as ALS2', async () => {
    const c = await built('als2-iv-medications');
    expectClaim(c, {
      classification: 'emergency',
      level: 'ALS2',
      emergency: true,
      lines: [
        ['A0433', 1],
        ['A0425', 6.9]
      ],
      originDestination: 'PH',
      payers: ['Blue Plan']
    });
    const { file } = await fileClaim(s, c.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0433:PH', 'HC:A0425:PH']);
  });

  it('files a critical care interfacility transfer as SCT between hospitals', async () => {
    const c = await built('sct-interfacility');
    expectClaim(c, {
      classification: 'scheduled',
      level: 'SCT',
      emergency: false,
      lines: [
        ['A0434', 1],
        ['A0425', 42.2]
      ],
      originDestination: 'HH',
      payers: ['Blue Plan']
    });
    const { file } = await fileClaim(s, c.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0434:HH', 'HC:A0425:HH']);
    assert.match(file, /CR1\*LB\*212\*\*D\*DH\*42\.2~/);
    assert.match(file, /CLM\*\d{8}-\d+\*[\d.]+\*\*\*41:B:1\*/);
  });

  it('never files SCT for a 911 response, even by a critical care crew', async () => {
    const c = await built('critical-care-scene');
    expectClaim(c, {
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 6.3]
      ],
      originDestination: 'RH'
    });
    const { file } = await fileClaim(s, c.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0427:RH', 'HC:A0425:RH']);
  });

  it('rounds 100 miles and over up to whole miles and flags an old certification', async () => {
    const c = await built('long-distance-stale-pcs');
    expectClaim(c, {
      classification: 'scheduled',
      level: 'BLS',
      emergency: false,
      lines: [
        ['A0428', 1],
        ['A0425', 124]
      ],
      originDestination: 'HH',
      payers: ['Medicare'],
      warnings: [/Loaded miles are over 100/, /signed 75 days before the trip/]
    });
    const { file } = await fileClaim(s, c.claim.id);
    assert.match(file, /SV1\*HC:A0425:HH\*[\d.]+\*UN\*124\*/);
    assert.match(file, /CR1\*{4}D\*DH\*124~/);
  });

  it('bills a downgraded 911 response under a mile with no payer to the patient, with no 837P', async () => {
    const c = await built('short-trip-self-pay');
    expectClaim(c, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 0.4]
      ],
      originDestination: 'RH',
      payers: [],
      warnings: [/No payer is on the claim/]
    });
    assert.equal(c.claim.signature, 'signed');
    await work(
      s,
      c.claim.id,
      [step('Confirm payers', 'Patient Pays')],
      (x) => x.claim.status === 'patient_balance',
      'the patient to be billed'
    );
    await eventLogged(s, c.claim.id, 'statement');
    assert.equal(c.files.filter((f) => f.batch_number !== null).length, 0);
  });
});
