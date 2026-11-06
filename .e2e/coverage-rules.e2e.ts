import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { expectClaim, segmentsOf } from './shared/expect.ts';
import {
  claimStatusIs,
  completeTask,
  draftClaim,
  fileClaim,
  type Session,
  SUITE_MS,
  signIn,
  uniqueId,
  uploadEncounters,
  workTasksUntil,
  workTasksUntilTask
} from './shared/session.ts';

const FIXTURES = [
  'dead-at-scene-ql',
  'multiple-patients-gm',
  'farther-facility-a0888',
  'work-injury-msp',
  'contract-facility'
] as const;

type Fixture = (typeof FIXTURES)[number];

let s: Session;
const pcrs = Object.fromEntries(FIXTURES.map((f) => [f, uniqueId('E2E-RULES')])) as Record<
  Fixture,
  string
>;

const claimOf = (fixture: Fixture) => draftClaim(s, pcrs[fixture]);

const lineModifiers = (file: string) =>
  segmentsOf(file, 'SV1').map((seg) => seg.split('*')[1]?.split(':').slice(1).join(':'));

describe('MSP, facility responsibility and line modifiers follow the report', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn();
    for (const fixture of FIXTURES) await uploadEncounters(s, pcrs[fixture], fixture);
  });

  after(async () => {
    await s?.browser.close();
  });

  it('bills a patient pronounced dead before loading as BLS with QL and no mileage', async () => {
    const built = await workTasksUntil(s, await claimOf('dead-at-scene-ql'), 'needs_review');
    expectClaim(built, {
      classification: 'treatNoTransport',
      level: 'BLS',
      emergency: true,
      lines: [['A0429', 1]]
    });
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineModifiers(file), ['A0429:QL']);
    assert.equal(segmentsOf(file, 'CR1').length, 0);
    assert.match(segmentsOf(file, 'NTE')[0] ?? '', /^NTE\*ADD\*A0429 EMERGENCY; PRONOUNCED DEAD/);
  });

  it('adds GM to every line and a note when several patients rode on the trip', async () => {
    const built = await workTasksUntil(s, await claimOf('multiple-patients-gm'), 'needs_review');
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineModifiers(file), ['A0427:RH:GM', 'A0425:RH:GM']);
    assert.match(segmentsOf(file, 'NTE')[0] ?? '', /2 PATIENTS TRANSPORTED/);
  });

  it('bills miles past the closest hospital on their own A0888 line with GY', async () => {
    const built = await workTasksUntil(s, await claimOf('farther-facility-a0888'), 'needs_review');
    expectClaim(built, {
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 2],
        ['A0888', 2.6]
      ]
    });
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineModifiers(file), ['A0427:RH', 'A0425:RH', 'A0888:RH:GY']);
  });

  it('bills workers compensation before Medicare for a work injury', async () => {
    const built = await workTasksUntil(s, await claimOf('work-injury-msp'), 'needs_review');
    assert.match(built.claim.coverages[0]?.payer ?? '', /Keystone/);
    assert.ok(!built.issues.some((i) => i.code === 'msp-order'));
  });

  it('asks a biller to bill a contract facility, then waits on its invoice', async () => {
    const claimId = await claimOf('contract-facility');
    await workTasksUntilTask(s, claimId, 'Bill facility');
    await completeTask(s, claimId, 'Bill facility', { outcome: 'Bill Facility' });
    await claimStatusIs(s, claimId, 'facility_billing');
  });
});
