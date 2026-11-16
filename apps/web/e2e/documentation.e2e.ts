import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  addDocument,
  decision,
  draftClaim,
  fileClaim,
  REVIEW_PCR,
  reviewed,
  step,
  uploadEncounters,
  workUntil,
  workUntilTask
} from './shared/claims.ts';
import { tagged } from './shared/config.ts';
import { expectClaim, lineCodes, segmentsOf } from './shared/expect.ts';
import { type Session, SUITE_MS, signIn, uniqueId } from './shared/session.ts';

const FIXTURES = [
  'scheduled-missing-pcs',
  'medicaid-by-payment-method-unsigned',
  'dependent-secondary-coverage',
  'missing-patient-details'
] as const;

type Fixture = (typeof FIXTURES)[number];

let s: Session;
const pcrs = Object.fromEntries(FIXTURES.map((f) => [f, uniqueId('E2E-DOC')])) as Record<
  Fixture,
  string
>;

const claimOf = (fixture: Fixture) => draftClaim(s, pcrs[fixture]);

describe('documentation and coverage decide whether a claim can be billed', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn();
    for (const fixture of FIXTURES) await uploadEncounters(s, pcrs[fixture], fixture);
  });

  after(async () => {
    await s?.browser.close();
  });

  it('holds a scheduled Medicare transport without a physician certification until one is added, then files it', async () => {
    const claimId = await claimOf('scheduled-missing-pcs');
    const stuck = await workUntilTask(s, claimId, REVIEW_PCR, 'Fix claim data');
    assert.equal(stuck.claim.status, 'draft');
    expectClaim(stuck, {
      classification: 'scheduled',
      level: 'BLS',
      emergency: false,
      lines: [
        ['A0428', 1],
        ['A0425', 8.5]
      ],
      originDestination: 'HN',
      payers: ['Medicare'],
      blocking: [/needs a physician certification statement/]
    });
    await addDocument(s, claimId, 'pcs', 'pcs.pdf', '2026-09-01');
    const built = await workUntil(s, claimId, [step('Fix claim data', 'Save')], 'needs_review');
    assert.ok(!built.issues.some((i) => i.field === 'pcs' && i.severity === 'blocking'));
    const { file } = await fileClaim(s, claimId);
    assert.deepEqual(lineCodes(file), ['HC:A0428:HN', 'HC:A0425:HN']);
  });

  it('bills Medicaid from the payment method once its member ID and a signed release are on file', async () => {
    const claimId = await claimOf('medicaid-by-payment-method-unsigned');
    const stuck = await workUntilTask(s, claimId, REVIEW_PCR, 'Fix claim data');
    expectClaim(stuck, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 4.5]
      ],
      originDestination: 'RH',
      payers: ['Medicaid'],
      blocking: [
        /The member ID for Medicaid is missing/,
        /crew was called out to another call, which is not a reason the patient could not sign/
      ]
    });
    assert.equal(stuck.claim.signature, 'missing');
    await addDocument(s, claimId, 'signature', 'release.pdf');
    const built = await workUntil(
      s,
      claimId,
      [
        step('Fix claim data', 'Save', async (d) => {
          await d
            .getByLabel(/Member ID/i)
            .first()
            .fill('PA0011223344');
        })
      ],
      'needs_review'
    );
    assert.equal(built.claim.signature, 'signed');
    const { file } = await fileClaim(s, claimId);
    assert.deepEqual(lineCodes(file), ['HC:A0429:RH', 'HC:A0425:RH']);
    assert.match(file, /NM1\*IL\*1\*[^~]*\*MI\*PA0011223344~/);
  });

  it('files a child under a parent policy first and Medicaid second, signed by the parent', async () => {
    const built = await reviewed(s, await claimOf('dependent-secondary-coverage'));
    expectClaim(built, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 5.8]
      ],
      originDestination: 'SH',
      payers: ['Blue Plan', 'Medicaid']
    });
    assert.deepEqual(
      built.claim.coverages.map((c) => c.relationship),
      ['19', '18']
    );
    assert.equal(built.claim.signature, 'signed');
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(segmentsOf(file, 'SBR')[0]?.split('*').slice(0, 3), ['SBR', 'P', '']);
    assert.match(file, /PAT\*19~/);
    const last = built.claim.last_name?.toUpperCase();
    const pcr = pcrs['dependent-secondary-coverage'];
    assert.ok(file.includes(`NM1*IL*1*${last}*${tagged(pcr, 'Miriam').toUpperCase()}*`));
    assert.ok(file.includes(`NM1*QC*1*${last}*${tagged(pcr, 'Ezra').toUpperCase()}~`));
  });

  it('asks for the name and birth date a report is missing before it matches the patient', async () => {
    const claimId = await claimOf('missing-patient-details');
    const rafael = tagged(pcrs['missing-patient-details'], 'Rafael');
    const built = await reviewed(s, claimId, [
      step('Complete patient details', 'Save Patient', async () => {
        const d = decision(s.page);
        await d.getByLabel(/^First Name/i).fill(rafael);
        await d.getByLabel(/^Birth Date/i).fill('1985-10-02');
      }),
      step('Review PCR', 'Approve')
    ]);
    assert.equal(built.claim.first_name, rafael);
    assert.equal(built.claim.last_name, tagged(pcrs['missing-patient-details'], 'Sandoval'));
    expectClaim(built, {
      classification: 'emergency',
      level: 'BLS',
      emergency: true,
      lines: [
        ['A0429', 1],
        ['A0425', 5.3]
      ],
      originDestination: 'RH',
      payers: ['Blue Plan'],
      warnings: [/Not signed because the patient's mental status was impaired/]
    });
    const { file } = await fileClaim(s, claimId);
    assert.deepEqual(lineCodes(file), ['HC:A0429:RH', 'HC:A0425:RH']);
    assert.match(file, /DMG\*D8\*19851002\*/);
  });
});
