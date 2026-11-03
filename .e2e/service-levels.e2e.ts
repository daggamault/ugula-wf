import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { expectClaim, segmentsOf } from './shared/expect.ts';
import {
  draftClaim,
  fileClaim,
  type Session,
  SUITE_MS,
  signIn,
  uniqueId,
  uploadEncounters,
  workTasksUntil
} from './shared/session.ts';

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

const reviewed = async (fixture: Fixture) =>
  workTasksUntil(s, await draftClaim(s, pcrs[fixture]), 'needs_review');

describe('the level of service follows what the report documents', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    for (const fixture of FIXTURES) await uploadEncounters(s, pcrs[fixture], fixture);
  });

  after(async () => {
    await s?.browser.close();
  });

  it('bills a resuscitation with defibrillation, an IO line and intubation as ALS2', async () => {
    const built = await reviewed('als2-cardiac-arrest');
    expectClaim(built, {
      tripType: 'emergency',
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
    assert.equal(built.claim.signature, 'exception');
  });

  it('does not count saline or dextrose toward ALS2', async () => {
    expectClaim(await reviewed('als1-iv-solutions'), {
      tripType: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 6.4]
      ],
      originDestination: 'EH',
      payers: ['Medicaid']
    });
  });

  it('bills three IV medication administrations, by push or pump, as ALS2', async () => {
    expectClaim(await reviewed('als2-iv-medications'), {
      tripType: 'emergency',
      level: 'ALS2',
      emergency: true,
      lines: [
        ['A0433', 1],
        ['A0425', 6.9]
      ],
      originDestination: 'PH',
      payers: ['Blue Plan']
    });
  });

  it('files a critical care interfacility transfer as SCT between hospitals', async () => {
    const built = await reviewed('sct-interfacility');
    expectClaim(built, {
      tripType: 'scheduled',
      level: 'SCT',
      emergency: false,
      lines: [
        ['A0434', 1],
        ['A0425', 42.2]
      ],
      originDestination: 'HH',
      payers: ['Blue Plan']
    });
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(
      segmentsOf(file, 'SV1').map((x) => x.split('*')[1]),
      ['HC:A0434:HH', 'HC:A0425:HH']
    );
    assert.match(file, /CR1\*LB\*212\*\*D\*DH\*42\.2~/);
    assert.match(file, /CLM\*\d+\*[\d.]+\*\*\*41:B:1\*/);
  });

  it('never bills SCT for a 911 response, even by a critical care crew', async () => {
    expectClaim(await reviewed('critical-care-scene'), {
      tripType: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 6.3]
      ],
      originDestination: 'RH'
    });
  });

  it('rounds 100 miles and over up to whole miles and flags an old certification', async () => {
    const built = await reviewed('long-distance-stale-pcs');
    expectClaim(built, {
      tripType: 'scheduled',
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
    const { file } = await fileClaim(s, built.claim.id);
    assert.match(file, /SV1\*HC:A0425:HH\*[\d.]+\*UN\*124\*/);
    assert.match(file, /CR1\*{4}D\*DH\*124~/);
  });

  it('bills a downgraded 911 response under a mile as BLS emergency with tenths of a mile', async () => {
    const built = await reviewed('short-trip-self-pay');
    expectClaim(built, {
      tripType: 'emergency',
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
    assert.equal(built.claim.signature, 'signed');
  });
});
