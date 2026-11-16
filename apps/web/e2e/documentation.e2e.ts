import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { expectClaim, segmentsOf } from './shared/expect.ts';
import {
  completeTask,
  draftClaim,
  fileClaim,
  type Session,
  SUITE_MS,
  section,
  signIn,
  uniqueId,
  uploadEncounters,
  workTasksUntil,
  workTasksUntilTask
} from './shared/session.ts';

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

  it('holds a scheduled Medicare transport without a physician certification in draft', async () => {
    const stuck = await workTasksUntilTask(
      s,
      await claimOf('scheduled-missing-pcs'),
      'Fix claim data'
    );
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
  });

  it('bills Medicaid from the payment method, but needs its member ID and a valid signature reason', async () => {
    const stuck = await workTasksUntilTask(
      s,
      await claimOf('medicaid-by-payment-method-unsigned'),
      'Fix claim data'
    );
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
  });

  it('bills a child under a parent policy first and Medicaid second, signed by the parent', async () => {
    const built = await workTasksUntil(
      s,
      await claimOf('dependent-secondary-coverage'),
      'needs_review'
    );
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
    assert.match(file, /NM1\*IL\*1\*CALLOWAY\*MIRIAM\*/);
    assert.match(file, /NM1\*QC\*1\*CALLOWAY\*EZRA~/);
  });

  it('asks for the name and birth date a report is missing before it matches the patient', async () => {
    const claimId = await claimOf('missing-patient-details');
    await completeTask(s, claimId, 'Complete patient details', {
      outcome: 'Save Patient',
      check: async () => {
        const decision = section(s.page, 'Your Decision').last();
        await decision.getByLabel(/^First Name/i).fill('Rafael');
        await decision.getByLabel(/^Birth Date/i).fill('1985-10-02');
      }
    });
    const built = await workTasksUntil(s, claimId, 'needs_review');
    assert.equal(built.claim.first_name, 'Rafael');
    assert.equal(built.claim.last_name, 'Sandoval');
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
  });
});
