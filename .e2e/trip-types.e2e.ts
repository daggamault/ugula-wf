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
  'bls-emergency-commercial',
  'emergent-interfacility',
  'scheduled-dialysis-pcs',
  'treat-no-transport-medicare',
  'refusal-unsigned',
  'cancelled-prior-to-arrival',
  'rescue-no-patient-care',
  'nemsis-34-emergency'
] as const;

type Fixture = (typeof FIXTURES)[number];

let s: Session;
const pcrs = Object.fromEntries(FIXTURES.map((f) => [f, uniqueId('E2E-TRIP')])) as Record<
  Fixture,
  string
>;

const claimOf = (fixture: Fixture) => draftClaim(s, pcrs[fixture]);

const reviewed = async (fixture: Fixture) =>
  workTasksUntil(s, await claimOf(fixture), 'needs_review');

describe('trip types decide what a report is billed as', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    for (const fixture of FIXTURES) await uploadEncounters(s, pcrs[fixture], fixture);
  });

  after(async () => {
    await s?.browser.close();
  });

  it('bills a 911 BLS response from a crash scene as BLS emergency from the scene', async () => {
    expectClaim(await reviewed('bls-emergency-commercial'), {
      tripType: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 8.3]
      ],
      originDestination: 'SH',
      payers: ['Blue Plan']
    });
  });

  it('bills an emergent interfacility transfer as an emergency and asks the biller to confirm it', async () => {
    expectClaim(await reviewed('emergent-interfacility'), {
      tripType: 'scheduled',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 13.6]
      ],
      originDestination: 'HH',
      payers: ['Medicare'],
      warnings: [/scheduled trip is billed as an emergency/]
    });
  });

  it('files a scheduled dialysis trip with its certification as BLS with RJ on every line', async () => {
    const built = await reviewed('scheduled-dialysis-pcs');
    expectClaim(built, {
      tripType: 'scheduled',
      level: 'BLS',
      emergency: false,
      lines: [
        ['A0428', 1],
        ['A0425', 5.9]
      ],
      originDestination: 'RJ',
      payers: ['Medicare']
    });
    assert.ok(!built.issues.some((i) => i.field === 'pcs'), 'the certification is current');
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(
      segmentsOf(file, 'SV1').map((x) => x.split('*')[1]),
      ['HC:A0428:RJ', 'HC:A0425:RJ']
    );
    assert.match(file, /CR1\*LB\*129\*\*A\*DH\*5\.9~/);
    assert.match(file, /CRC\*07\*Y\*04\*12~/);
  });

  it('bills Medicare treatment without transport as A0998 with GY and no mileage', async () => {
    const built = await reviewed('treat-no-transport-medicare');
    expectClaim(built, {
      tripType: 'treatNoTransport',
      level: 'ALS1',
      emergency: true,
      lines: [['A0998', 1]],
      payers: ['Medicare']
    });
    assert.equal(built.claim.loaded_miles, null);
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(
      segmentsOf(file, 'SV1').map((x) => x.split('*')[1]),
      ['HC:A0998:GY']
    );
    assert.equal(segmentsOf(file, 'CR1').length, 0, 'no transport, no CR1');
    assert.equal(
      file.split('~').filter((x) => x.trim().startsWith('NM1*45*')).length,
      0,
      'no drop-off'
    );
  });

  it('keeps a refusal whose patient would not sign for billing in draft for a biller', async () => {
    const stuck = await workTasksUntilTask(s, await claimOf('refusal-unsigned'), 'Fix claim data');
    assert.equal(stuck.claim.status, 'draft');
    expectClaim(stuck, {
      tripType: 'refusal',
      level: 'BLS',
      emergency: true,
      lines: [['A0998', 1]],
      payers: ['Blue Plan'],
      blocking: [/refused to sign the release for billing/]
    });
  });

  it('asks before voiding a call cancelled before arrival', async () => {
    const claimId = await claimOf('cancelled-prior-to-arrival');
    await completeTask(s, claimId, 'Confirm no claim', { outcome: 'Skip' });
    await claimStatusIs(s, claimId, 'void');
  });

  it('treats a rescue with no patient care as no claim, not a treat-no-transport', async () => {
    const claimId = await claimOf('rescue-no-patient-care');
    await completeTask(s, claimId, 'Confirm no claim', { outcome: 'Skip' });
    const { claim } = await claimStatusIs(s, claimId, 'void');
    assert.equal(claim.lines.length, 0);
  });

  it('reads a NEMSIS 3.4 report by its incident disposition', async () => {
    const built = await reviewed('nemsis-34-emergency');
    expectClaim(built, {
      tripType: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 6.9]
      ],
      originDestination: 'RH',
      payers: ['Medicare']
    });
    assert.equal(built.claim.last_name, 'Thorncastle');
  });
});
