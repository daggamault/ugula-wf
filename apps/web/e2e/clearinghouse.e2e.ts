import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  claimEvents,
  claimIs,
  claimStatusIs,
  eventLogged,
  fileClaim,
  importEncounter,
  openClaim,
  reviewed,
  step,
  workTask
} from './shared/claims.ts';
import {
  AGENCIES,
  api,
  type Session,
  SUITE_MS,
  section,
  signIn,
  uniqueId
} from './shared/session.ts';

let s: Session;

const pcrs = {
  paid: uniqueId('E2E-LIVE'),
  rejected: uniqueId('E2E-LIVE'),
  inactive: uniqueId('E2E-LIVE'),
  advantage: uniqueId('E2E-LIVE'),
  inpatient: uniqueId('E2E-LIVE')
};

const claims = { paid: '', rejected: '', inactive: '', advantage: '', inpatient: '' };

describe('the live mock clearinghouse answers what the agency sends it over SFTP', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn(AGENCIES.live);
    const { connection } = await api<{ connection: unknown }>(s, '/api/clearinghouse-connection');
    assert.equal(connection, null, 'the live agency uses the server default connection');
    claims.paid = await importEncounter(s, pcrs.paid);
    claims.rejected = await importEncounter(s, pcrs.rejected, undefined, {
      memberPrefix: 'REJECT'
    });
    claims.inactive = await importEncounter(s, pcrs.inactive, undefined, {
      memberPrefix: 'INACTIVE'
    });
    claims.advantage = await importEncounter(s, pcrs.advantage, undefined, {
      memberPrefix: 'ADVANTAGE'
    });
    claims.inpatient = await importEncounter(s, pcrs.inpatient, undefined, {
      memberPrefix: 'INPATIENT'
    });
  });

  after(async () => {
    await s?.browser.close();
  });

  it('checks eligibility in real time and shows the coverage active', async () => {
    await reviewed(s, claims.paid);
    await claimIs(
      s,
      claims.paid,
      (c) => c.claim.coverages[0]?.eligibility === 'active',
      'the 271 to report the coverage active'
    );
    await openClaim(s, claims.paid);
    await section(s.page, 'Eligibility').getByText('Active', { exact: true }).first().waitFor();
  });

  it('uploads the 837P, then posts the 999, the 277CA and the 835 the clearinghouse sends back', async () => {
    const { file } = await fileClaim(s, claims.paid);
    assert.match(file, /^ISA\*00\*.{10}\*00\*.{10}\*ZZ\*DEVEMS01\s*\*ZZ\*WAYSTAR/);
    await eventLogged(s, claims.paid, 'accepted');
    const paid = await claimStatusIs(s, claims.paid, 'paid');
    const response = (await claimEvents(s, claims.paid)).find((e) => e.kind === 'response');
    assert.equal(response?.paid_cents, Math.round(paid.claim.total_cents * 0.8));
    assert.match(response?.payer_claim_number ?? '', /^MOCK-/);
  });

  it('sends a claim the clearinghouse rejects for its member ID back to review with why', async () => {
    await reviewed(s, claims.rejected);
    await fileClaim(s, claims.rejected);
    await eventLogged(s, claims.rejected, 'rejected');
    await claimStatusIs(s, claims.rejected, 'needs_review');
    const rejected = (await claimEvents(s, claims.rejected)).find((e) => e.kind === 'rejected');
    assert.match(rejected?.note ?? '', /Invalid member ID/);
  });

  it('blocks billing a payer whose 271 says the coverage ended', async () => {
    await reviewed(s, claims.inactive);
    await claimIs(
      s,
      claims.inactive,
      (c) => c.issues.some((i) => i.code === 'coverage-inactive'),
      'the inactive coverage to block billing'
    );
  });

  it('asks a biller to bill the Medicare Advantage plan a 271 names', async () => {
    await reviewed(s, claims.advantage);
    await workTask(
      s,
      claims.advantage,
      step('Review payer file line', 'Resolved', async (d) => {
        await d
          .page()
          .getByText(/Bill the Medicare Advantage plan instead/)
          .first()
          .waitFor();
      }),
      ['Review claim']
    );
  });

  it('warns when a 271 reports the patient admitted on the date of service', async () => {
    await reviewed(s, claims.inpatient);
    await claimIs(
      s,
      claims.inpatient,
      (c) => c.issues.some((i) => i.code === 'facility-stay-reported'),
      'the reported stay to be flagged'
    );
  });
});
