import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  addDocument,
  claimStatusIs,
  draftClaim,
  fileClaim,
  REVIEW_PCR,
  reviewed,
  step,
  uploadEncounters,
  workTask,
  workUntil,
  workUntilTask
} from './shared/claims.ts';
import { tagged } from './shared/config.ts';
import { expectClaim, lineCodes, segmentsOf } from './shared/expect.ts';
import { chooseOption, listboxByLabel } from './shared/listbox.ts';
import { type Session, SUITE_MS, signIn, uniqueId } from './shared/session.ts';

const FIXTURES = {
  bls: 'bls-emergency-commercial',
  interfacility: 'emergent-interfacility',
  dialysis: 'scheduled-dialysis-pcs',
  treated: 'treat-no-transport-medicare',
  refusal: 'refusal-unsigned',
  cancelled: 'cancelled-prior-to-arrival',
  overridden: 'cancelled-prior-to-arrival',
  rescue: 'rescue-no-patient-care',
  nemsis34: 'nemsis-34-emergency'
} as const;

type Trip = keyof typeof FIXTURES;

let s: Session;
const pcrs = Object.fromEntries(
  Object.keys(FIXTURES).map((k) => [k, uniqueId('E2E-TRIP')])
) as Record<Trip, string>;

const claimOf = (trip: Trip) => draftClaim(s, pcrs[trip]);

describe('classifications decide what a report is billed as', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    for (const [trip, fixture] of Object.entries(FIXTURES)) {
      await uploadEncounters(s, pcrs[trip as Trip], fixture);
    }
  });

  after(async () => {
    await s?.browser.close();
  });

  it('files a 911 BLS response from a crash scene as BLS emergency from the scene', async () => {
    const built = await reviewed(s, await claimOf('bls'));
    expectClaim(built, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 8.3]
      ],
      originDestination: 'SH',
      payers: ['Blue Plan']
    });
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0429:SH', 'HC:A0425:SH']);
    assert.match(file, /CR1\*{3,4}A\*DH\*8\.3~/);
    assert.match(file, /SBR\*P\*18\*[^*]*\*\*\*\*\*\*BL~/);
  });

  it('files an emergent interfacility transfer as an emergency and asks the biller to confirm it', async () => {
    const built = await reviewed(s, await claimOf('interfacility'));
    expectClaim(built, {
      classification: 'scheduled',
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
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0427:HH', 'HC:A0425:HH']);
    assert.match(file, /CR1\*{3,4}[A-Z]\*DH\*13\.6~/);
  });

  it('files a scheduled dialysis trip with its certification as BLS with RJ on every line', async () => {
    const built = await reviewed(s, await claimOf('dialysis'));
    expectClaim(built, {
      classification: 'scheduled',
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
    assert.deepEqual(lineCodes(file), ['HC:A0428:RJ', 'HC:A0425:RJ']);
    assert.match(file, /CR1\*LB\*129\*\*A\*DH\*5\.9~/);
    assert.match(file, /CRC\*07\*Y\*04\*12~/);
  });

  it('files Medicare treatment without transport as A0998 with GY and no mileage', async () => {
    const built = await reviewed(s, await claimOf('treated'));
    expectClaim(built, {
      classification: 'treatNoTransport',
      level: 'ALS1',
      emergency: true,
      lines: [['A0998', 1]],
      payers: ['Medicare']
    });
    assert.equal(built.claim.loaded_miles, null);
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0998:GY']);
    assert.equal(segmentsOf(file, 'CR1').length, 0, 'no transport, no CR1');
    assert.equal(
      segmentsOf(file, 'NM1').filter((x) => x.startsWith('NM1*45*')).length,
      0,
      'no drop-off'
    );
  });

  it('holds a refusal the patient would not sign until a signed release arrives, then files it', async () => {
    const claimId = await claimOf('refusal');
    const stuck = await workUntilTask(s, claimId, REVIEW_PCR, 'Fix claim data');
    assert.equal(stuck.claim.status, 'draft');
    expectClaim(stuck, {
      classification: 'refusal',
      level: 'BLS',
      emergency: true,
      lines: [['A0998', 1]],
      payers: ['Blue Plan'],
      blocking: [/refused to sign the release for billing/]
    });
    await addDocument(s, claimId, 'signature', 'release.pdf');
    const built = await workUntil(s, claimId, [step('Fix claim data', 'Save')], 'needs_review');
    assert.equal(built.claim.signature, 'signed');
    const { file } = await fileClaim(s, claimId);
    assert.deepEqual(lineCodes(file), ['HC:A0998']);
    assert.match(file, /CLM\*[^~]*\*41:B:1\*Y\*A\*Y\*Y~/);
  });

  it('asks before voiding a call cancelled before arrival', async () => {
    const claimId = await claimOf('cancelled');
    await workUntil(s, claimId, [step('Confirm Not Billable', 'Skip Claim')], 'void');
  });

  it('builds a claim of the classification a biller chooses for a call it would not bill, and asks for what it lacks', async () => {
    const claimId = await claimOf('overridden');
    await workTask(
      s,
      claimId,
      step('Confirm Not Billable', 'Make Claim', async (d) => {
        await chooseOption(listboxByLabel(d, /^Classification/i), 'treatNoTransport');
      })
    );
    const built = await workUntilTask(
      s,
      claimId,
      [
        step('Complete patient details', 'Save Patient', async (d) => {
          await d.getByLabel(/^First Name/i).fill(tagged(pcrs.overridden, 'Avery'));
          await d.getByLabel(/^Last Name/i).fill(tagged(pcrs.overridden, 'Lindell'));
          await d.getByLabel(/^Birth Date/i).fill('1950-04-11');
        }),
        ...REVIEW_PCR
      ],
      'Fix claim data'
    );
    expectClaim(built, {
      classification: 'treatNoTransport',
      level: built.claim.level ?? '',
      emergency: built.claim.is_emergency ?? false,
      lines: [['A0998', 1]],
      payers: [],
      blocking: [
        /street address is missing/,
        /city is missing/,
        /state is missing/,
        /ZIP code is missing/,
        /diagnosis code is required/
      ]
    });
    await workUntil(s, claimId, [step('Fix claim data', 'Void')], 'void');
  });

  it('treats a rescue with no patient care as no claim, not a treat-no-transport', async () => {
    const claimId = await claimOf('rescue');
    const { claim } = await workUntil(
      s,
      claimId,
      [step('Confirm Not Billable', 'Skip Claim')],
      'void'
    );
    assert.equal(claim.lines.length, 0);
    await claimStatusIs(s, claimId, 'void');
  });

  it('files a NEMSIS 3.4 report by its incident disposition', async () => {
    const built = await reviewed(s, await claimOf('nemsis34'));
    expectClaim(built, {
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', 6.9]
      ],
      originDestination: 'RH',
      payers: ['Medicare']
    });
    assert.equal(built.claim.last_name, tagged(pcrs.nemsis34, 'Thorncastle'));
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineCodes(file), ['HC:A0427:RH', 'HC:A0425:RH']);
    assert.match(file, /CR1\*{3,4}A\*DH\*6\.9~/);
  });
});
