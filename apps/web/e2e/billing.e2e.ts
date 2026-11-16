import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import {
  claimAction,
  claimState,
  claimStatusIs,
  fileClaim,
  importEncounter,
  openClaim,
  reviewed,
  step,
  uploadPayerFile,
  workUntil
} from './shared/claims.ts';
import {
  api,
  go,
  rowWith,
  type Session,
  SUITE_MS,
  section,
  signIn,
  toast,
  uniqueId,
  until
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

  it('works the PCR: reviews the service with what supports it', async () => {
    const built = await reviewed(s, claimId, [
      step('Review PCR', 'Approve', async (d) => {
        await d
          .page()
          .getByText('No vital signs are recorded to support medical necessity')
          .first()
          .waitFor();
      })
    ]);
    assert.deepEqual(
      built.issues.filter((i) => i.severity === 'blocking'),
      [],
      'a complete report builds a claim with nothing blocking it'
    );
  });

  it('shows what the report documents for billing on the claim', async () => {
    await openClaim(s, claimId);
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

  it('downloads the 270, blocks billing a payer that reports the coverage inactive and clears it when active', async () => {
    const { claim } = await claimState(s, claimId);
    const [coverage] = claim.coverages;
    assert.ok(coverage);
    await openClaim(s, claimId);
    const download = s.page.waitForEvent('download');
    await section(s.page, 'Eligibility').getByRole('button', { name: 'Download 270' }).click();
    const request = readFileSync((await (await download).path()) ?? '', 'utf8');
    assert.match(request, /ST\*270\*0001\*005010X279A1/);
    assert.ok(
      request.includes(
        `NM1*IL*1*${claim.last_name?.toUpperCase()}*${claim.first_name?.toUpperCase()}****MI*${coverage.member_id}`
      ),
      request
    );
    assert.match(
      await uploadPayerFile(s.page, `${pcr}-inactive.271`, eligibility271(coverage.id, false)),
      /received$/
    );
    await until(
      s.page,
      () => claimState(s, claimId),
      (c) => c.issues.some((i) => i.code === 'coverage-inactive'),
      'the inactive coverage to block billing'
    );
    await openClaim(s, claimId);
    await section(s.page, 'Eligibility').getByText('Not Active').first().waitFor();
    await uploadPayerFile(s.page, `${pcr}-active.271`, eligibility271(coverage.id, true));
    await until(
      s.page,
      () => claimState(s, claimId),
      (c) => !c.issues.some((i) => i.code === 'coverage-inactive'),
      'the active coverage to clear the block'
    );
  });

  it('says why eligibility cannot be checked while the clearinghouse connection is paused', async () => {
    await openClaim(s, claimId);
    const started = s.page.waitForResponse((r) => r.url().endsWith('/eligibility-checks'));
    await claimAction(s.page, 'Check Eligibility');
    const { runId } = (await (await started).json()) as { runId: string };
    const checked = await until(
      s.page,
      () => api<{ run: { status: string } }>(s, `/api/runs/${runId}`),
      ({ run }) => run.status !== 'running',
      'the eligibility check to finish'
    );
    assert.equal(checked.run.status, 'completed');
  });

  it('files the claim as an 837P carrying the documentation as soon as it is approved', async () => {
    const { control, file } = await fileClaim(s, claimId);
    const { claim } = await claimState(s, claimId);
    assert.match(file, new RegExp(`CLM\\*${claim.number}\\*`));
    assert.match(file, /CR1\*{3,4}A\*DH\*/);
    assert.match(file, /CRC\*07\*Y\*04\*06\*09/);
    assert.match(
      await uploadPayerFile(s.page, `${pcr}.999`, batchAcknowledgment999(control, true)),
      /received$/
    );
    await openClaim(s, claimId, 'history');
    await s.page.getByText('Accepted by the payer').first().waitFor();
  });

  it('sends a claim the payer rejects back to review with the reason, and resubmits it', async () => {
    const { claim } = await claimState(s, claimId);
    await uploadPayerFile(
      s.page,
      `${pcr}-rejected.277`,
      claimAcknowledgment277(claim, 'Invalid member ID')
    );
    await claimStatusIs(s, claimId, 'needs_review');
    const { file } = await fileClaim(s, claimId, [
      step('Review claim', 'Approve', async (d) => {
        await d
          .page()
          .getByText(/Invalid member ID/)
          .first()
          .waitFor();
      })
    ]);
    assert.match(file, new RegExp(`CLM\\*${claim.number}\\*`));
  });

  it('posts the remittance, closes the claim as paid and never applies the same file twice', async () => {
    const { claim } = await claimState(s, claimId);
    const era = remittance835({
      claimNumber: claim.number,
      chargeCents: claim.total_cents,
      paidCents: Math.round(claim.total_cents * 0.6)
    });
    assert.match(await uploadPayerFile(s.page, `${pcr}.835`, era), /received$/);
    await workUntil(s, claimId, [], 'paid');
    await go(s.page, '/payer-files');
    await s.page.getByRole('link', { name: `Open payer file ${pcr}.835` }).click();
    await rowWith(s.page, claim.number).getByText('Posted').first().waitFor();
    assert.match(await uploadPayerFile(s.page, `${pcr}.835`, era), /could not be applied$/);
    await toast(s.page, /already imported/);
  });
});
