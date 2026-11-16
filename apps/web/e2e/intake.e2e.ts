import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  addDocument,
  claimState,
  decide,
  decision,
  draftClaim,
  encounter,
  fileClaim,
  REVIEW_PCR,
  reviewed,
  startClaimTask,
  step,
  workUntil
} from './shared/claims.ts';
import type { PatientOptions } from './shared/config.ts';
import { lineCodes } from './shared/expect.ts';
import { chooseOption, chosenValue, listboxByLabel } from './shared/listbox.ts';
import {
  api,
  chooseFile,
  go,
  heading,
  type Session,
  SUITE_MS,
  signIn,
  toasts,
  uniqueId,
  until
} from './shared/session.ts';

const FIXTURE = 'new-patient-medicare';

const withBirthTypo = (xml: string) =>
  xml.replace(
    /(<ePatient\.17>\d{4}-\d{2}-)(\d{2})(<\/ePatient\.17>)/,
    (_, head, day: string, tail) =>
      `${head}${day === '30' ? '20' : day === '31' ? '30' : `${day[0]}${day[1] === '1' ? '2' : '1'}`}${tail}`
  );

let s: Session;

const upload = async (pcr: string, xml: string) => {
  await go(s.page, '/imports');
  await heading(s.page, 'Imports').waitFor();
  await chooseFile(s.page, 'Import Files', {
    name: `${pcr}.xml`,
    mimeType: 'text/xml',
    buffer: Buffer.from(xml)
  });
  await toasts(s.page).getByText(`${pcr}.xml received`).waitFor();
  return draftClaim(s, pcr);
};

const imported = (pcr: string, o: PatientOptions = {}, fixture = FIXTURE) =>
  upload(pcr, encounter(pcr, fixture, o));

const patientOf = async (claimId: string) =>
  ((await claimState(s, claimId)).claim as unknown as { patient_id: string }).patient_id;

const payerIdOf = async (name: string) => {
  const { items } = await api<{ items: { id: string; name: string }[] }>(
    s,
    `/api/payers?q=${encodeURIComponent(name)}`
  );
  const found = items.find((p) => p.name === name);
  assert.ok(found, `${name} is in the payer directory`);
  return found.id;
};

const unknownPayer = (id: string) => ({
  'Simulated Medicare Part B': { name: `Medicare Part B ${id}`, code: 'SIM00001' }
});

describe('intake matches patients and payers and recovers stopped drafts', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn();
  });

  after(async () => {
    await s?.browser.close();
  });

  it('asks whether a report with a mistyped birth date is a known patient, and uses the one chosen', async () => {
    const seed = uniqueId('E2E-PAT');
    const first = await imported(uniqueId('E2E-INTAKE'), { seed });
    await reviewed(s, first);
    const known = await patientOf(first);
    const pcr = uniqueId('E2E-INTAKE');
    const second = await upload(pcr, withBirthTypo(encounter(pcr, FIXTURE, { seed })));
    await reviewed(s, second, [
      step('Confirm patient', 'Use Selected Patient', async (d) => {
        assert.equal(await chosenValue(listboxByLabel(d, /^Candidate Patient/i)), known);
      }),
      ...REVIEW_PCR
    ]);
    assert.equal(await patientOf(second), known);
  });

  it('creates a new patient when the biller says the similar one is someone else', async () => {
    const seed = uniqueId('E2E-PAT');
    const first = await imported(uniqueId('E2E-INTAKE'), { seed });
    await reviewed(s, first);
    const pcr = uniqueId('E2E-INTAKE');
    const second = await upload(pcr, withBirthTypo(encounter(pcr, FIXTURE, { seed })));
    await reviewed(s, second, [step('Confirm patient', 'Create New Patient'), ...REVIEW_PCR]);
    assert.notEqual(await patientOf(second), await patientOf(first));
  });

  it('links a payer name the directory does not know, and links it by itself the next time', async () => {
    const medicare = await payerIdOf('Medicare');
    const payers = unknownPayer(uniqueId('E2E'));
    const first = await imported(uniqueId('E2E-INTAKE'), { payers });
    const built = await reviewed(s, first, [
      step('Match payer', 'Link Payer', async (d) => {
        const choice = listboxByLabel(d, /^Directory Payer/i);
        if (await choice.count()) await chooseOption(choice, medicare);
        else await d.getByLabel(/^Directory Payer/i).fill(medicare);
      }),
      ...REVIEW_PCR
    ]);
    assert.deepEqual(
      built.claim.coverages.map((c) => c.payer),
      ['Medicare']
    );
    const again = await reviewed(s, await imported(uniqueId('E2E-INTAKE'), { payers }));
    assert.deepEqual(
      again.claim.coverages.map((c) => c.payer),
      ['Medicare']
    );
  });

  it('leaves a reported payer that is not insurance off the claim', async () => {
    const claimId = await imported(uniqueId('E2E-INTAKE'), {
      payers: unknownPayer(uniqueId('E2E'))
    });
    const built = await reviewed(s, claimId, [step('Match payer', 'Remove Payer'), ...REVIEW_PCR]);
    assert.deepEqual(built.claim.coverages, []);
  });

  it('asks what to do with a draft whose workflow was cancelled, and works it again', async () => {
    const pcr = uniqueId('E2E-INTAKE');
    const claimId = await imported(pcr);
    await until(
      s.page,
      () => claimState(s, claimId),
      (c) => c.claim.tasks.some((t) => t.title === 'Review PCR'),
      'a Review PCR task'
    );
    const { items } = await api<{ items: { file_name: string; run_id: string }[] }>(
      s,
      `/api/imports?q=${encodeURIComponent(pcr)}`
    );
    const ingest = items.find((i) => i.file_name === `${pcr}.xml`);
    const { children } = await api<{ children: { id: string; status: string }[] }>(
      s,
      `/api/runs/${ingest?.run_id}`
    );
    const [run] = children;
    assert.ok(run, 'the import started an Encounter to Claim run');
    await go(s.page, `/runs/${run.id}`);
    await s.page.getByRole('button', { name: 'Cancel Run' }).click();
    await s.page
      .getByRole('dialog', { name: 'Cancel Run?' })
      .getByRole('button', { name: 'Cancel Run' })
      .click();
    await until(
      s.page,
      () => api<{ run: { status: string } }>(s, `/api/runs/${run.id}`),
      ({ run: r }) => r.status === 'cancelled',
      'the run to be cancelled'
    );
    await workUntil(
      s,
      claimId,
      [step('Draft claim has no workflow', 'Restart'), ...REVIEW_PCR],
      'needs_review'
    );
  });

  it('files GA on a non-emergency Medicare trip once an ABN is on file', async () => {
    const claimId = await imported(uniqueId('E2E-INTAKE'), {}, 'scheduled-dialysis-pcs');
    await reviewed(s, claimId);
    await addDocument(s, claimId, 'abn', 'abn.pdf', '2026-09-01');
    const { file } = await fileClaim(s, claimId);
    const lines = lineCodes(file);
    assert.equal(lines.length, 2);
    assert.ok(
      lines.every((l) => l?.split(':').includes('GA')),
      lines.join(' ')
    );
  });

  it('files GZ when Medicare is expected to deny and no ABN is on file', async () => {
    const claimId = await imported(uniqueId('E2E-INTAKE'), {}, 'scheduled-dialysis-pcs');
    await reviewed(s, claimId);
    await startClaimTask(s, claimId, 'Correct Claim Data');
    await decision(s.page).getByLabel('Medicare is expected to deny the transport').check();
    await decide(s.page, 'Save');
    await until(
      s.page,
      () => claimState(s, claimId),
      (c) => c.issues.some((i) => i.code === 'abn-missing'),
      'the missing ABN warning'
    );
    const { file } = await fileClaim(s, claimId);
    const lines = lineCodes(file);
    assert.ok(
      lines.every((l) => l?.split(':').includes('GZ')),
      lines.join(' ')
    );
  });
});
