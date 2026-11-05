import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import {
  api,
  claimState,
  claimStatusIs,
  completeTask,
  go,
  heading,
  importEncounter,
  latest837,
  type Session,
  SUITE_MS,
  section,
  signIn,
  toasts,
  uniqueId,
  until,
  uploadPayerFile,
  workTasksUntil
} from './shared/session.ts';
import {
  batchAcknowledgment999,
  claimAcknowledgment277,
  eligibility271,
  remittance835
} from './shared/x12.ts';

const pcr = uniqueId('E2E-BILL');

let s: Session;
let claimId = '';

const openClaim = async () => {
  await go(s.page, `/claims/${claimId}`);
  await heading(s.page, /^Claim \d{8}-\d{4,}$/).waitFor();
};

describe('a biller takes an encounter from import to payment', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
  });

  after(async () => {
    await s?.browser.close();
  });

  it('imports a NEMSIS file and opens a draft claim for its PCR', async () => {
    claimId = await importEncounter(s, pcr);
    assert.equal((await claimState(s, claimId)).claim.status, 'draft');
  });

  it('works the PCR: links the payer and reviews the service with what supports it', async () => {
    let reviewed = false;
    const built = await workTasksUntil(s, claimId, 'needs_review', {
      'Review PCR': {
        check: async () => {
          await s.page
            .getByText('No vital signs are recorded to support medical necessity')
            .first()
            .waitFor();
          reviewed = true;
        }
      }
    });
    assert.ok(reviewed, 'a biller reviewed the PCR');
    assert.deepEqual(
      built.issues.filter((i) => i.severity === 'blocking'),
      [],
      'a complete report builds a claim with nothing blocking it'
    );
  });

  it('shows what the report documents for billing on the claim', async () => {
    await openClaim();
    const documentation = section(s.page, 'Documentation');
    await documentation
      .getByText('Signed by the patient or their representative')
      .first()
      .waitFor();
    await documentation
      .getByText(/^A · Nearest facility/)
      .first()
      .waitFor();
    await documentation
      .getByText(/04 · Patient was moved by stretcher/)
      .first()
      .waitFor();
  });

  it('checks eligibility through the clearinghouse, downloads the 270 and blocks billing a payer that reports the coverage inactive', async () => {
    await openClaim();
    const eligibility = section(s.page, 'Eligibility');
    const download = s.page.waitForEvent('download');
    await eligibility.getByRole('button', { name: 'Download 270' }).click();
    const request = readFileSync((await (await download).path()) ?? '', 'utf8');
    assert.match(request, /ST\*270\*0001\*005010X279A1/);
    assert.match(request, /NM1\*IL\*1\*KLINE\*DOROTHY\*{4}MI\*2KT7XM4RW91/);
    const started = s.page.waitForResponse((r) => r.url().endsWith('/eligibility-checks'));
    await eligibility.getByRole('button', { name: 'Check Eligibility' }).click();
    const { runId } = (await (await started).json()) as { runId: string };
    await toasts(s.page).getByText('Eligibility check sent to the clearinghouse').waitFor();
    const checked = await until(
      s.page,
      () => api<{ run: { status: string } }>(s, `/api/runs/${runId}`),
      ({ run }) => run.status !== 'running',
      'the eligibility check to finish'
    );
    assert.equal(checked.run.status, 'completed');
    const [coverage] = (await claimState(s, claimId)).claim.coverages;
    assert.ok(coverage);
    assert.match(
      await uploadPayerFile(s.page, `${pcr}-inactive.271`, eligibility271(coverage.id, false)),
      /received$/
    );
    await until(
      s.page,
      () => claimState(s, claimId),
      (c) => c.issues.some((i) => /reports this coverage is not active/.test(i.message)),
      'the inactive coverage to block billing'
    );
    await openClaim();
    await section(s.page, 'Eligibility').getByText('Not Active').first().waitFor();
    await uploadPayerFile(s.page, `${pcr}-active.271`, eligibility271(coverage.id, true));
    await until(
      s.page,
      () => claimState(s, claimId),
      (c) => !c.issues.some((i) => /not active/.test(i.message)),
      'the active coverage to clear the block'
    );
  });

  it('files the claim as an 837P carrying the documentation as soon as it is approved', async () => {
    await completeTask(s, claimId, 'Review claim', { outcome: 'Approve' });
    const filed = await claimStatusIs(s, claimId, 'submitted');
    const { control, file } = await latest837(s, claimId);
    assert.match(file, new RegExp(`CLM\\*${filed.claim.number}\\*`));
    assert.match(file, /CR1\*{3,4}A\*DH\*/);
    assert.match(file, /CRC\*07\*Y\*04\*06\*09/);
    assert.match(
      await uploadPayerFile(s.page, `${pcr}.999`, batchAcknowledgment999(control, true)),
      /received$/
    );
    await openClaim();
    await s.page.getByRole('link', { name: /History/ }).click();
    await s.page.getByText('Accepted by the payer').first().waitFor();
  });

  it('sends a claim the payer rejects back to review with the reason, and resubmits it', async () => {
    const { claim } = await claimState(s, claimId);
    await uploadPayerFile(
      s.page,
      `${pcr}-rejected.277`,
      claimAcknowledgment277(claim.number, 'Invalid member ID')
    );
    await claimStatusIs(s, claimId, 'needs_review');
    await completeTask(s, claimId, 'Review claim', {
      outcome: 'Approve',
      check: async () => {
        await s.page
          .getByText(/Invalid member ID/)
          .first()
          .waitFor();
      }
    });
    const { claim: resubmitted } = await claimStatusIs(s, claimId, 'submitted');
    const { file } = await latest837(s, claimId);
    assert.match(file, new RegExp(`CLM\\*${resubmitted.number}\\*`));
  });

  it('posts the remittance, closes the claim as paid and never applies the same file twice', async () => {
    const { claim } = await claimState(s, claimId);
    const paid = Math.round(claim.total_cents * 0.6);
    const era = remittance835(claim.number, claim.total_cents, paid);
    assert.match(await uploadPayerFile(s.page, `${pcr}.835`, era), /received$/);
    await claimStatusIs(s, claimId, 'paid');
    await go(s.page, '/payer-files');
    await s.page.getByRole('link', { name: `Open payer file ${pcr}.835` }).click();
    await s.page
      .getByRole('row')
      .filter({ hasText: claim.number })
      .getByText('Posted')
      .first()
      .waitFor();
    assert.match(await uploadPayerFile(s.page, `${pcr}.835`, era), /could not be applied$/);
    await toasts(s.page)
      .getByText(/already imported/)
      .first()
      .waitFor();
  });
});
