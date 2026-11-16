import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  approve,
  claimEvents,
  claimIs,
  claimState,
  claimStatusIs,
  decide,
  decision,
  eventLogged,
  fileClaim,
  importEncounter,
  reviewed,
  startClaimTask,
  step,
  uploadPayerFile,
  work,
  workTask,
  workUntil
} from './shared/claims.ts';
import { paidByOthersCents, segmentsOf } from './shared/expect.ts';
import {
  api,
  go,
  rowWith,
  type Session,
  SUITE_MS,
  signIn,
  uniqueId,
  until
} from './shared/session.ts';
import {
  batchAcknowledgment999,
  claimStatus277,
  interchangeRejectedTA1,
  payerClaimNumberOf,
  providerRejection277,
  remittance835,
  remittanceFor
} from './shared/x12.ts';

const CASES = {
  rejected999: 'new-patient-medicare',
  rejectedTa1: 'new-patient-medicare',
  providerRejected: 'new-patient-medicare',
  patientShare: 'new-patient-medicare',
  secondary: 'dependent-secondary-coverage',
  crossover: 'dependent-secondary-coverage',
  reversal: 'new-patient-medicare',
  overpaid: 'new-patient-medicare',
  plb: 'new-patient-medicare'
} as const;

type Case = keyof typeof CASES;

let s: Session;
const pcrs = Object.fromEntries(
  Object.keys(CASES).map((k) => [k, uniqueId('E2E-REMIT')])
) as Record<Case, string>;
const claims = {} as Record<Case, string>;

const reconcile = step('Reconcile payment', 'Continue');

const isaControl = (file: string) => Number(file.slice(0, 120).split('*')[13]);

const filed = async (c: Case) => {
  await reviewed(s, claims[c]);
  return fileClaim(s, claims[c]);
};

const upload = (c: Case, ext: string, text: string) =>
  uploadPayerFile(s.page, `${pcrs[c]}-${uniqueId('F')}.${ext}`, text);

describe('payer files move claims through acknowledgments, payments and corrections', {
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

  it('sends a claim whose 837P batch a 999 rejects back to review and files it again', async () => {
    const first = await filed('rejected999');
    assert.match(
      await upload('rejected999', '999', batchAcknowledgment999(first.control, false)),
      /received$/
    );
    await eventLogged(s, claims.rejected999, 'rejected');
    const again = await fileClaim(s, claims.rejected999, [
      step('Review claim', 'Approve', async (d) => {
        await d
          .page()
          .getByText(new RegExp(`837P file ${first.control}`))
          .first()
          .waitFor();
      })
    ]);
    assert.ok(again.control > first.control, 'the refiled claim goes in a new batch');
  });

  it('sends every claim of a batch a TA1 rejects back to review and asks to fix the clearinghouse setup', async () => {
    const first = await filed('rejectedTa1');
    const name = `${pcrs.rejectedTa1}.ta1`;
    assert.match(
      await uploadPayerFile(s.page, name, interchangeRejectedTA1(isaControl(first.file))),
      /received$/
    );
    await eventLogged(s, claims.rejectedTa1, 'rejected');
    const fix = await until(
      s.page,
      () =>
        api<{ items: { id: string; title: string; subject: string | null }[] }>(
          s,
          '/api/tasks?q=clearinghouse&pageSize=100'
        ),
      (r) => r.items.some((t) => t.title === 'Fix clearinghouse setup' && t.subject === name),
      'a Fix clearinghouse setup task'
    );
    const task = fix.items.find((t) => t.subject === name);
    await go(s.page, `/tasks/${task?.id}`);
    await s.page
      .getByText(/Invalid interchange content/)
      .first()
      .waitFor();
    await decide(s.page, 'Fixed');
    const again = await fileClaim(s, claims.rejectedTa1);
    assert.ok(again.control > first.control);
  });

  it('rejects the claims of a billing provider a 277CA rejects', async () => {
    await filed('providerRejected');
    const { claim } = await claimState(s, claims.providerRejected);
    assert.match(
      await upload(
        'providerRejected',
        '277',
        providerRejection277(claim, 'Billing provider NPI not on file')
      ),
      /received$/
    );
    await claimIs(
      s,
      claims.providerRejected,
      (c) => c.claim.status === 'needs_review',
      'the claim back in review'
    );
    const rejected = (await claimEvents(s, claims.providerRejected)).find(
      (e) => e.kind === 'rejected'
    );
    assert.match(rejected?.note ?? '', /Billing provider NPI not on file/);
  });

  it('records a 277 claim status, then bills the patient the coinsurance Medicare leaves', async () => {
    const { file } = await filed('patientShare');
    const { claim } = await claimState(s, claims.patientShare);
    await upload(
      'patientShare',
      '277',
      claimStatus277(claim.number, { category: 'A2', code: '20', message: 'In process' })
    );
    await eventLogged(s, claims.patientShare, 'claim_status');
    await go(s.page, `/claims/${claims.patientShare}?tab=history`);
    await s.page
      .getByText(/In process/)
      .first()
      .waitFor();
    const remit = remittanceFor(claim.number, file, {
      paid: 0.6,
      patient: 0.15,
      patientReason: '2'
    });
    await upload('patientShare', '835', remittance835(remit));
    const billed = await work(
      s,
      claims.patientShare,
      [reconcile, step('Review claim', 'Approve')],
      (c) => c.claim.status === 'patient_balance',
      'the patient to be billed'
    );
    assert.equal(billed.claim.balance_cents, remit.patientCents);
    await eventLogged(s, claims.patientShare, 'statement');
  });

  it('bills the secondary payer after the primary pays, reporting its adjudication in 2320 and 2430', async () => {
    const primary = await filed('secondary');
    const { claim } = await claimState(s, claims.secondary);
    const remit = remittanceFor(
      claim.number,
      primary.file,
      { paid: 0.5, patient: 0.2, patientReason: '2' },
      'Blue Plan'
    );
    await upload('secondary', '835', remittance835(remit));
    const second = await fileClaim(s, claims.secondary, [reconcile, approve]);
    const [sbr, other] = segmentsOf(second.file, 'SBR');
    assert.match(sbr ?? '', /^SBR\*S\*/);
    assert.match(other ?? '', /^SBR\*P\*/);
    assert.match(second.file, /NM1\*PR\*2\*[^*]*\*{5}PI\*DEMOMCD/);
    assert.deepEqual(paidByOthersCents(second.file), [remit.paidCents]);
    assert.equal(segmentsOf(second.file, 'SVD').length, 2, 'one SVD per line');
    assert.ok(segmentsOf(second.file, 'CAS').some((x) => x.startsWith('CAS*PR*2*')));
  });

  it('waits on the next payer when the primary says it crossed the claim over', async () => {
    await filed('crossover');
    const { claim } = await claimState(s, claims.crossover);
    await upload(
      'crossover',
      '835',
      remittance835({
        claimNumber: claim.number,
        payer: 'Blue Plan',
        status: '19',
        chargeCents: claim.total_cents,
        paidCents: Math.round(claim.total_cents * 0.5),
        patientCents: Math.round(claim.total_cents * 0.2),
        crossover: 'Medicaid'
      })
    );
    await eventLogged(s, claims.crossover, 'crossed_over');
    await work(
      s,
      claims.crossover,
      [reconcile],
      (c) => c.claim.status === 'submitted',
      'waiting on Medicaid'
    );
    const after = await claimState(s, claims.crossover);
    assert.equal(
      after.files.filter((f) => f.batch_number !== null).length,
      1,
      'Medicaid is not billed again'
    );
  });

  it('posts a reversal with its corrected payment as a pair', async () => {
    await filed('reversal');
    const { claim } = await claimState(s, claims.reversal);
    const charge = claim.total_cents;
    const first = Math.round(charge * 0.5);
    const share = Math.round(charge * 0.2);
    await upload(
      'reversal',
      '835',
      remittance835({
        claimNumber: claim.number,
        chargeCents: charge,
        paidCents: first,
        patientCents: share
      })
    );
    await claimStatusIs(s, claims.reversal, 'reconcile');
    const corrected = Math.round(charge * 0.7);
    await upload(
      'reversal',
      '835',
      remittance835([
        {
          claimNumber: claim.number,
          status: '22',
          chargeCents: -charge,
          paidCents: -first,
          patientCents: -share,
          adjustments: [
            { group: 'CO', reason: '45', cents: -(charge - first - share) },
            { group: 'PR', reason: '2', cents: -share }
          ]
        },
        { claimNumber: claim.number, chargeCents: charge, paidCents: corrected }
      ])
    );
    const responses = await until(
      s.page,
      async () => (await claimEvents(s, claims.reversal)).filter((e) => e.kind === 'response'),
      (r) => r.length === 3,
      'the reversal and the corrected payment to post'
    );
    assert.deepEqual(
      responses.map((r) => r.paid_cents).toSorted((a, b) => (a ?? 0) - (b ?? 0)),
      [-first, first, corrected]
    );
    const paid = await workUntil(s, claims.reversal, [], 'paid');
    assert.equal(paid.claim.balance_cents, 0);
  });

  it('refunds an overpayment once someone with approval rights approves it', async () => {
    await filed('overpaid');
    const { claim } = await claimState(s, claims.overpaid);
    await startClaimTask(s, claims.overpaid, 'Post Payment');
    const payment = decision(s.page);
    await payment
      .getByLabel(/^Paid or Refunded/i)
      .fill(((claim.total_cents + 5_000) / 100).toFixed(2));
    await payment.getByLabel(/^Paid On$/i).fill('2026-10-20');
    await decide(s.page, 'Post Payment');
    await claimIs(s, claims.overpaid, (c) => c.claim.balance_cents === -5_000, 'a $50 credit');
    const refunded = await workUntil(
      s,
      claims.overpaid,
      [step('Approve refund', 'Approve Refund')],
      'paid'
    );
    assert.equal(refunded.claim.balance_cents, 0);
    const refund = (await claimEvents(s, claims.overpaid)).find((e) => e.kind === 'refunded');
    assert.equal(refund?.paid_cents, -5_000);
  });

  it('leaves a provider-level adjustment for a biller to post by hand', async () => {
    await filed('plb');
    const { claim } = await claimState(s, claims.plb);
    await upload(
      'plb',
      '835',
      remittance835(
        { claimNumber: claim.number, chargeCents: claim.total_cents, paidCents: claim.total_cents },
        [{ reason: 'WO', reference: payerClaimNumberOf(claim.number), cents: 2_500 }]
      )
    );
    const { payerFiles } = await claimIs(
      s,
      claims.plb,
      (c) => c.payerFiles.length > 0,
      'the 835 on the claim'
    );
    assert.match(
      payerFiles[0]?.items[1]?.message ?? '',
      /provider-level adjustment \(PLB WO\) of \$25\b/
    );
    await workTask(s, claims.plb, step('Review payer file line', 'Resolved'));
    await go(s.page, '/payer-files');
    await rowWith(s.page, pcrs.plb).first().waitFor();
  });
});
