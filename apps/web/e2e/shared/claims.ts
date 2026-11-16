import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureUrl } from '@ugula/nemsis/testing';
import type { Locator, Page } from 'playwright-core';
import { type PatientOptions, withPatient, withPcr } from './config.ts';
import { chooseOption, listboxByLabel } from './listbox.ts';
import {
  api,
  apiText,
  chooseFile,
  FLOW_MS,
  go,
  heading,
  type Session,
  section,
  toasts,
  until
} from './session.ts';

export type ClaimState = {
  claim: {
    id: string;
    number: string;
    status: string;
    total_cents: number;
    balance_cents: number;
    classification: string | null;
    level: string | null;
    is_emergency: boolean | null;
    loaded_miles: string | number | null;
    origin_code: string | null;
    destination_code: string | null;
    signature: string;
    first_name: string | null;
    last_name: string | null;
    birth_date: string | null;
    facility_id: string | null;
    coverages: {
      id: string;
      payer: string;
      relationship: string;
      member_id: string | null;
      eligibility: string | null;
    }[];
    lines: { code: string; units: string | number }[];
    transport_reason: string | null;
    tasks: { id: string; title: string }[];
  };
  files: {
    id: string;
    kind: string;
    batch_id: string | null;
    batch_number: number | null;
    has_document: boolean;
    note: string | null;
  }[];
  payerFiles: { kind: string; file_name: string; items: { outcome: string; message: string }[] }[];
  documents: { kind: string; file_name: string }[];
  issues: { code: string; severity: string; field: string; message: string }[];
};

export type ClaimEvent = {
  id: string;
  kind: string;
  payer: string | null;
  paid_cents: number | null;
  adjusted_cents: number | null;
  payer_claim_number: string | null;
  note: string | null;
};

export const encounter = (
  pcr: string,
  fixture = 'new-patient-medicare',
  patient: PatientOptions = {}
) => withPatient(withPcr(readFileSync(fixtureUrl(fixture), 'utf8'), pcr), pcr, patient);

export const uploadEncounters = async (
  s: Session,
  pcr: string,
  fixture?: string,
  patient?: PatientOptions
) => {
  await go(s.page, '/imports');
  await heading(s.page, 'Imports').waitFor();
  await chooseFile(s.page, 'Import Files', {
    name: `${pcr}.xml`,
    mimeType: 'text/xml',
    buffer: Buffer.from(encounter(pcr, fixture, patient))
  });
  await toasts(s.page).getByText(`${pcr}.xml received`).waitFor();
};

export const draftClaim = async (s: Session, pcr: string) => {
  const found = await until(
    s.page,
    () =>
      api<{ items: { id: string }[] }>(
        s,
        `/api/claims?number=${encodeURIComponent(pcr)}&status=all`
      ),
    (r) => r.items.length > 0,
    `the draft claim for ${pcr}`
  );
  return found.items[0]?.id ?? '';
};

export const importEncounter = async (
  s: Session,
  pcr: string,
  fixture?: string,
  patient?: PatientOptions
) => {
  await uploadEncounters(s, pcr, fixture, patient);
  return draftClaim(s, pcr);
};

export const claimState = (s: Session, claimId: string) =>
  api<ClaimState>(s, `/api/claims/${claimId}`);

export const claimEvents = async (s: Session, claimId: string) =>
  (await api<{ items: ClaimEvent[] }>(s, `/api/claims/${claimId}/events?pageSize=100`)).items;

export const claimIs = (
  s: Session,
  claimId: string,
  done: (c: ClaimState) => boolean,
  what: string
) => until(s.page, () => claimState(s, claimId), done, what);

export const claimStatusIs = (s: Session, claimId: string, status: string) =>
  claimIs(s, claimId, (c) => c.claim.status === status, `the claim to be ${status}`);

export const eventLogged = (s: Session, claimId: string, kind: string) =>
  until(
    s.page,
    () => claimEvents(s, claimId),
    (events) => events.some((e) => e.kind === kind),
    `a ${kind} event on the claim`
  );

export const openClaim = async (s: Session, claimId: string, tab = '') => {
  await go(s.page, `/claims/${claimId}${tab ? `?tab=${tab}` : ''}`);
  await heading(s.page, /^Claim \d{8}-\d{4,}$/).waitFor();
};

export const decision = (page: Page) => section(page, 'Your Decision').last();

export const claimAction = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Start Task' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
};

export const startClaimTask = async (s: Session, claimId: string, name: string) => {
  await openClaim(s, claimId);
  await claimAction(s.page, name);
  await s.page.waitForURL(/\/tasks\/[^/?]+/, { timeout: FLOW_MS });
  await decision(s.page).waitFor();
};

export const decide = async (page: Page, outcome: string) => {
  const button = decision(page).getByRole('button', { name: outcome, exact: true });
  const reason = await button.getAttribute('aria-disabled');
  if (reason === 'true') {
    const ids = ((await button.getAttribute('aria-describedby')) ?? '').split(' ');
    const why = await Promise.all(
      ids.filter(Boolean).map(async (id) => page.locator(`[id="${id}"]`).textContent())
    );
    assert.fail(`${outcome} is disabled: ${why.join(' ')}`);
  }
  await button.click();
  const confirm = page.getByRole('dialog', { name: `${outcome}?` });
  const done = page.getByRole('heading', { name: 'Done' });
  await done.or(confirm).first().waitFor();
  if (await confirm.isVisible()) {
    await confirm.getByRole('button', { name: outcome, exact: true }).click();
    await done.waitFor();
  }
};

export type Step = {
  task: string;
  outcome: string;
  act?: (decision: Locator) => Promise<void>;
};

export const step = (task: string, outcome: string, act?: Step['act']): Step => ({
  task,
  outcome,
  ...(act ? { act } : {})
});

const unexpected = (c: ClaimState, expected: readonly string[]) =>
  c.claim.tasks.filter((t) => !expected.includes(t.title)).map((t) => t.title);

export const workTask = async (s: Session, claimId: string, st: Step, also: string[] = []) => {
  const c = await claimIs(
    s,
    claimId,
    (c) => {
      const extra = unexpected(c, [st.task, ...also]);
      assert.deepEqual(extra, [], `the claim waits on tasks it should not: ${extra.join(', ')}`);
      return c.claim.tasks.some((t) => t.title === st.task);
    },
    `a "${st.task}" task`
  );
  const task = c.claim.tasks.find((t) => t.title === st.task);
  const isOpen = async () =>
    (await claimState(s, claimId)).claim.tasks.some((t) => t.id === task?.id);
  for (let attempt = 1; ; attempt++) {
    try {
      await go(s.page, `/tasks/${task?.id}`);
      await decision(s.page).waitFor();
      await st.act?.(decision(s.page));
      await decide(s.page, st.outcome);
      break;
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      if (attempt > 1 || !timedOut || !(await isOpen())) throw err;
    }
  }
  await claimIs(
    s,
    claimId,
    (c) => !c.claim.tasks.some((t) => t.id === task?.id),
    `the "${st.task}" task to close`
  );
};

export const work = async (
  s: Session,
  claimId: string,
  steps: readonly Step[],
  done: (c: ClaimState) => boolean,
  what: string
) => {
  for (const [i, st] of steps.entries()) {
    await workTask(
      s,
      claimId,
      st,
      steps.slice(i + 1).map((x) => x.task)
    );
  }
  return claimIs(
    s,
    claimId,
    (c) => {
      if (done(c)) return true;
      const extra = c.claim.tasks.map((t) => t.title);
      assert.deepEqual(extra, [], `the claim waits on tasks it should not: ${extra.join(', ')}`);
      return false;
    },
    what
  );
};

export const workUntil = (s: Session, claimId: string, steps: readonly Step[], status: string) =>
  work(s, claimId, steps, (c) => c.claim.status === status, `the claim to be ${status}`);

export const workUntilTask = (s: Session, claimId: string, steps: readonly Step[], title: string) =>
  work(s, claimId, steps, (c) => c.claim.tasks.some((t) => t.title === title), `a "${title}" task`);

export const REVIEW_PCR = [step('Review PCR', 'Approve')] as const;

export const reviewed = (s: Session, claimId: string, steps: readonly Step[] = REVIEW_PCR) =>
  workUntil(s, claimId, steps, 'needs_review');

export const claimFiles = async (s: Session, claimId: string) => {
  const { files } = await claimState(s, claimId);
  return [
    ...new Map(files.filter((f) => f.batch_id !== null).map((f) => [f.batch_id, f])).values()
  ];
};

export const batchFile = (s: Session, batchId: string | null) =>
  apiText(s, `/api/submissions/batches/${batchId}/file`);

export const latest837 = async (s: Session, claimId: string) => {
  const files = await until(
    s.page,
    () => claimFiles(s, claimId),
    (f) => f.length > 0,
    'an 837P file on the claim'
  );
  const latest = files.reduce((a, b) => ((b.batch_number ?? 0) > (a.batch_number ?? 0) ? b : a));
  return { control: latest.batch_number ?? 0, file: await batchFile(s, latest.batch_id) };
};

export const filed837s = async (s: Session, claimId: string, count: number) => {
  const files = await until(
    s.page,
    () => claimFiles(s, claimId),
    (f) => f.length >= count,
    `${count} 837P files on the claim`
  );
  return Promise.all(
    files
      .toSorted((a, b) => (a.batch_number ?? 0) - (b.batch_number ?? 0))
      .map(async (f) => ({ control: f.batch_number ?? 0, file: await batchFile(s, f.batch_id) }))
  );
};

export const approve = step('Review claim', 'Approve');

export const fileClaim = async (
  s: Session,
  claimId: string,
  steps: readonly Step[] = [approve]
) => {
  const before = (await claimFiles(s, claimId)).length;
  await work(s, claimId, steps, (c) => c.claim.status === 'submitted', 'the claim to be submitted');
  const files = await filed837s(s, claimId, before + 1);
  const last = files.at(-1);
  assert.ok(last);
  return last;
};

export const uploadPayerFile = async (page: Page, name: string, text: string) => {
  await go(page, '/payer-files');
  await heading(page, 'Payer Files').waitFor();
  await chooseFile(page, 'Upload Payer Files', {
    name,
    mimeType: 'application/edi-x12',
    buffer: Buffer.from(text)
  });
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toast = toasts(page).getByText(new RegExp(`^${escaped} (received|could not be applied)$`));
  await toast.waitFor();
  return (await toast.textContent()) ?? '';
};

export const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
});

export const addDocument = async (
  s: Session,
  claimId: string,
  kind: 'facesheet' | 'pcs' | 'signature' | 'abn' | 'msp',
  name: string,
  signedOn?: string
) => {
  await startClaimTask(s, claimId, 'Add Document');
  const d = decision(s.page);
  await chooseOption(listboxByLabel(d, /^Document\b/), kind);
  if (signedOn) await d.getByLabel(/^Signed On/i).fill(signedOn);
  await d.getByLabel(/^File/).setInputFiles(pdf(name));
  await d.getByText(`Uploaded ${name}`).waitFor();
  await decide(s.page, 'Add Document');
  await claimIs(
    s,
    claimId,
    (c) => c.documents.some((x) => x.file_name === name),
    `${name} on the claim`
  );
};
