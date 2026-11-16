import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  approve,
  type ClaimState,
  claimEvents,
  claimIs,
  claimState,
  eventLogged,
  fileClaim,
  filed837s,
  importEncounter,
  reviewed,
  type Step,
  step,
  uploadPayerFile,
  work,
  workTask
} from './shared/claims.ts';
import { segmentsOf } from './shared/expect.ts';
import { chooseOption, listboxByLabel } from './shared/listbox.ts';
import { api, type Session, SUITE_MS, signIn, uniqueId } from './shared/session.ts';
import { type PayerName, payerClaimNumberOf, remittance835 } from './shared/x12.ts';

const CASES = {
  replaced: 'bls-emergency-commercial',
  voided: 'bls-emergency-commercial',
  refiled: 'new-patient-medicare',
  reopened: 'new-patient-medicare',
  appealed: 'new-patient-medicare',
  otherPayer: 'bls-emergency-commercial',
  toPatient: 'bls-emergency-commercial',
  writtenOff: 'bls-emergency-commercial'
} as const;

type Case = keyof typeof CASES;

const WRITE_OFF_APPROVAL_CENTS = 50_000;

let s: Session;
const pcrs = Object.fromEntries(Object.keys(CASES).map((k) => [k, uniqueId('E2E-DENY')])) as Record<
  Case,
  string
>;
const claims = {} as Record<Case, string>;

const payerOf = (c: Case): PayerName =>
  CASES[c] === 'new-patient-medicare' ? 'Medicare' : 'Blue Plan';

const filed = async (c: Case) => {
  await reviewed(s, claims[c]);
  return fileClaim(s, claims[c]);
};

const deny = async (c: Case, reason: string) => {
  const { claim } = await claimState(s, claims[c]);
  const era = remittance835({
    claimNumber: claim.number,
    payer: payerOf(c),
    status: '4',
    chargeCents: claim.total_cents,
    paidCents: 0,
    adjustments: [{ group: 'CO', reason, cents: claim.total_cents }]
  });
  assert.match(
    await uploadPayerFile(s.page, `${pcrs[c]}-${uniqueId('DENY')}.835`, era),
    /received$/
  );
  await eventLogged(s, claims[c], 'denied');
  return claim;
};

const decideDenial = (outcome: string, act?: Step['act'], suggested?: RegExp) =>
  step('Denial decision', outcome, async (d) => {
    if (suggested) await d.page().getByText(suggested).first().waitFor();
    await act?.(d);
  });

const frequencyOf = (file: string) => segmentsOf(file, 'CLM')[0]?.split('*')[5]?.split(':')[2];

const noTasks = (c: ClaimState) => c.claim.tasks.length === 0;

describe('a biller works denials: corrects, voids, reopens, appeals, rebills or closes them', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn();
    for (const [c, fixture] of Object.entries(CASES)) {
      claims[c as Case] = await importEncounter(s, pcrs[c as Case], fixture);
    }
  });

  after(async () => {
    await s?.browser.close();
  });

  it('replaces a claim a commercial payer denied for missing data with frequency 7 and its claim number', async () => {
    await filed('replaced');
    const claim = await deny('replaced', '16');
    const replaced = await fileClaim(s, claims.replaced, [
      decideDenial(
        'Correct Claim',
        (d) => chooseOption(listboxByLabel(d, /^Correction/), 'replace'),
        /correcting it is suggested/
      ),
      step('Fix claim data', 'Save'),
      approve
    ]);
    assert.equal(frequencyOf(replaced.file), '7');
    assert.ok(
      replaced.file.includes(`REF*F8*${payerClaimNumberOf(claim.number, 'Blue Plan')}~`),
      'the replacement names the claim it replaces'
    );
  });

  it('voids a denied claim with frequency 8 at once and moves on from the payer', async () => {
    await filed('voided');
    const claim = await deny('voided', '16');
    await workTask(
      s,
      claims.voided,
      decideDenial('Correct Claim', (d) => chooseOption(listboxByLabel(d, /^Correction/), 'void'))
    );
    const [, voided] = await filed837s(s, claims.voided, 2);
    assert.equal(frequencyOf(voided?.file ?? ''), '8');
    assert.ok(voided?.file.includes(`REF*F8*${payerClaimNumberOf(claim.number, 'Blue Plan')}~`));
    await eventLogged(s, claims.voided, 'payer_skipped');
  });

  it('files a claim Medicare could not process (CO-16) again as a new claim', async () => {
    const first = await filed('refiled');
    await deny('refiled', '16');
    const again = await fileClaim(s, claims.refiled, [
      decideDenial('Correct Claim'),
      step('Fix claim data', 'Save'),
      approve
    ]);
    assert.ok(again.control > first.control);
    assert.equal(frequencyOf(again.file), '1');
    assert.equal(segmentsOf(again.file, 'REF').filter((x) => x.startsWith('REF*F8*')).length, 0);
  });

  it('asks for a Medicare reopening when Medicare processed the claim', async () => {
    await filed('reopened');
    await deny('reopened', '4');
    await work(
      s,
      claims.reopened,
      [
        decideDenial('Correct Claim'),
        step('Request reopening', 'Mark Requested', (d) =>
          d.getByLabel(/^Reopening Reference/i).fill('REOPEN-E2E-1')
        )
      ],
      noTasks,
      'the claim to wait on the reopening'
    );
    await eventLogged(s, claims.reopened, 'reopening_requested');
  });

  it('appeals a medical necessity denial with a packet and records the payer overturning it', async () => {
    await filed('appealed');
    const claim = await deny('appealed', '50');
    await workTask(s, claims.appealed, decideDenial('Appeal', undefined, /an appeal is suggested/));
    await claimIs(
      s,
      claims.appealed,
      (c) => c.files.some((f) => f.kind === 'appeal_packet' && f.has_document),
      'an appeal packet in the claim files'
    );
    await workTask(s, claims.appealed, step('Send appeal', 'Mark Sent'));
    await eventLogged(s, claims.appealed, 'appealed');
    const paid = Math.round(claim.total_cents * 0.8);
    await uploadPayerFile(
      s.page,
      `${pcrs.appealed}-overturned.835`,
      remittance835({ claimNumber: claim.number, chargeCents: claim.total_cents, paidCents: paid })
    );
    await eventLogged(s, claims.appealed, 'appeal_decided');
    const decided = (await claimEvents(s, claims.appealed)).find(
      (e) => e.kind === 'appeal_decided'
    );
    assert.match(decided?.note ?? '', /overturned/i);
  });

  it('bills another payer the denial names and files the claim to it', async () => {
    await filed('otherPayer');
    await deny('otherPayer', '22');
    const { items } = await api<{ items: { id: string; name: string }[] }>(
      s,
      '/api/payers?q=Medicaid'
    );
    const medicaid = items.find((p) => p.name === 'Medicaid');
    assert.ok(medicaid);
    const next = await fileClaim(s, claims.otherPayer, [
      decideDenial(
        'Bill Another Payer',
        async (d) => {
          await chooseOption(listboxByLabel(d, /^Directory Payer/), medicaid.id);
          await d.getByLabel(/^Member ID/).fill('PA0099887766');
        },
        /billing another payer is suggested/
      ),
      approve
    ]);
    assert.match(next.file, /NM1\*PR\*2\*MEDICAID\*{5}PI\*DEMOMCD~/);
    assert.match(next.file, /NM1\*IL\*1\*[^~]*\*MI\*PA0099887766~/);
  });

  it('moves a denied balance to the patient and bills them', async () => {
    await filed('toPatient');
    await deny('toPatient', '96');
    await work(
      s,
      claims.toPatient,
      [decideDenial('Move to Patient'), approve],
      (c) => c.claim.status === 'patient_balance',
      'the patient to be billed'
    );
    await eventLogged(s, claims.toPatient, 'statement');
  });

  it('writes off a balance filed too late, with approval above the limit', async () => {
    await filed('writtenOff');
    const claim = await deny('writtenOff', '29');
    const steps = [
      decideDenial('Write Off', undefined, /writing it off is suggested/),
      ...(claim.total_cents > WRITE_OFF_APPROVAL_CENTS
        ? [step('Approve write-off', 'Approve')]
        : [])
    ];
    const closed = await work(
      s,
      claims.writtenOff,
      steps,
      (c) => c.claim.status === 'written_off',
      'the claim to be written off'
    );
    assert.equal(closed.claim.status, 'written_off');
  });
});
