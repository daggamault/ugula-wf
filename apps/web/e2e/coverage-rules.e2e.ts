import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  approve,
  draftClaim,
  fileClaim,
  reviewed,
  step,
  uploadEncounters,
  uploadPayerFile,
  workUntil
} from './shared/claims.ts';
import { expectClaim, lineCodes, paidByOthersCents, segmentsOf } from './shared/expect.ts';
import { type Session, SUITE_MS, signIn, uniqueId } from './shared/session.ts';
import { type PayerName, remittance835, remittanceFor } from './shared/x12.ts';

const FIXTURES = [
  'dead-at-scene-ql',
  'multiple-patients-gm',
  'farther-facility-a0888',
  'work-injury-msp',
  'auto-accident-msp',
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
  lineCodes(file).map((code) => code?.split(':').slice(1).join(':'));

const billedAfter = async (fixture: Fixture, primary: PayerName, filing: string) => {
  const built = await reviewed(s, await claimOf(fixture));
  assert.deepEqual(
    built.claim.coverages.map((c) => c.payer),
    [primary, 'Medicare']
  );
  assert.ok(!built.issues.some((i) => i.code === 'msp-order'));
  const first = await fileClaim(s, built.claim.id);
  assert.match(first.file, new RegExp(`SBR\\*P\\*18\\*[^*]*\\*\\*\\*\\*\\*\\*${filing}~`));
  const remit = remittanceFor(built.claim.number, first.file, { paid: 0.5, patient: 0.2 }, primary);
  assert.match(
    await uploadPayerFile(s.page, `${pcrs[fixture]}.835`, remittance835(remit)),
    /received$/
  );
  const second = await fileClaim(s, built.claim.id, [
    step('Reconcile payment', 'Continue'),
    approve
  ]);
  return { built, remit, file: second.file };
};

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

  it('files a patient pronounced dead before loading as BLS with QL and no mileage', async () => {
    const built = await reviewed(s, await claimOf('dead-at-scene-ql'));
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

  it('files GM on every line and a note when several patients rode on the trip', async () => {
    const built = await reviewed(s, await claimOf('multiple-patients-gm'));
    expectClaim(built, {
      classification: 'emergency',
      level: 'ALS1',
      emergency: true,
      lines: [
        ['A0427', 1],
        ['A0425', Number(built.claim.lines[1]?.units)]
      ],
      originDestination: 'RH',
      payers: ['Medicare']
    });
    const { file } = await fileClaim(s, built.claim.id);
    assert.deepEqual(lineModifiers(file), ['A0427:RH:GM', 'A0425:RH:GM']);
    assert.match(segmentsOf(file, 'NTE')[0] ?? '', /2 PATIENTS TRANSPORTED/);
    assert.equal(segmentsOf(file, 'QTY').length, 2);
  });

  it('files miles past the closest hospital on their own A0888 line with GY', async () => {
    const built = await reviewed(s, await claimOf('farther-facility-a0888'));
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

  it('bills workers compensation first, then Medicare as the secondary payer for a work injury (SBR05 15)', async () => {
    const { file, remit } = await billedAfter('work-injury-msp', 'Keystone Comp', 'WC');
    const [, medicare] = segmentsOf(file, 'SBR');
    assert.match(segmentsOf(file, 'SBR')[0] ?? '', /^SBR\*S\*18\*[^*]*\*\*15\*/);
    assert.ok(medicare, 'the other payer is reported in 2320');
    assert.deepEqual(paidByOthersCents(file), [remit.paidCents]);
  });

  it('bills the auto insurer first, then Medicare as the secondary payer for a crash (SBR05 14)', async () => {
    const { file } = await billedAfter('auto-accident-msp', 'Keystone Auto', 'CI');
    assert.match(segmentsOf(file, 'SBR')[0] ?? '', /^SBR\*S\*18\*[^*]*\*\*14\*/);
  });

  it('asks a biller to bill a contract facility, then waits on its invoice', async () => {
    await workUntil(
      s,
      await claimOf('contract-facility'),
      [step('Review PCR', 'Approve'), step('Bill facility', 'Bill Facility')],
      'facility_billing'
    );
  });
});
