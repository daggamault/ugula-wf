import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  approve,
  claimAction,
  claimIs,
  claimState,
  decide,
  decision,
  draftClaim,
  eventLogged,
  openClaim,
  pdf,
  REVIEW_PCR,
  reviewed,
  startClaimTask,
  step,
  uploadEncounters,
  workTask,
  workUntil
} from './shared/claims.ts';
import { chooseOption, chosenValue, listboxByLabel } from './shared/listbox.ts';
import {
  AGENCIES,
  api,
  apiText,
  go,
  heading,
  type Session,
  SUITE_MS,
  send,
  signIn,
  toast,
  uniqueId,
  until
} from './shared/session.ts';

const lateId = uniqueId('LATE');

const late = { name: `Late Plan ${lateId}`, code: lateId.replace(/[^A-Za-z0-9]/g, '') };

const CASES = {
  deadline: ['bls-emergency-commercial', { payers: { 'Blue Plan': late } }],
  invoiced: ['contract-facility', {}],
  chased: ['scheduled-dialysis-pcs', {}],
  facility: ['bls-emergency-commercial', {}],
  restarted: ['bls-emergency-commercial', {}]
} as const;

type Case = keyof typeof CASES;

let s: Session;
const pcrs = Object.fromEntries(
  Object.keys(CASES).map((k) => [k, uniqueId('E2E-SCHED')])
) as Record<Case, string>;
const claims = {} as Record<Case, string>;

const graphId = async (key: string) => {
  const { items } = await api<{ items: { id: string; key: string }[] }>(
    s,
    `/api/graphs?show=workflows&q=${encodeURIComponent(key)}`
  );
  const found = items.find((g) => g.key === key);
  assert.ok(found, `${key} is published`);
  return found.id;
};

const runWorkflow = async (key: string, title: string) => {
  await go(s.page, `/runs/new?graph=${await graphId(key)}`);
  await heading(s.page, `Run ${title}`).waitFor();
  await s.page.getByRole('button', { name: 'Start Run' }).click();
  await s.page.waitForURL(/\/runs\/[\w-]+$/);
  const runId = s.page.url().split('/').at(-1) ?? '';
  const { run } = await until(
    s.page,
    () => api<{ run: { status: string } }>(s, `/api/runs/${runId}`),
    (r) => r.run.status !== 'running' && r.run.status !== 'waiting',
    `${title} to finish`
  );
  assert.equal(run.status, 'completed');
};

const idOf = async (path: string, name: string) => {
  const { items } = await api<{ items: { id: string; name: string }[] }>(
    s,
    `${path}?q=${encodeURIComponent(name)}`
  );
  const found = items.find((x) => x.name === name);
  assert.ok(found, `${name} is listed`);
  return found.id;
};

const reminders = async (claimId: string) =>
  (await claimState(s, claimId)).claim.tasks.filter((t) => t.title === 'Deadline coming up');

describe('scheduled workflows watch deadlines and invoice facilities', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn(AGENCIES.live);
    await send(s, 'PUT', '/api/payers', {
      name: late.name,
      payerCode: late.code,
      claimFiling: 'CI',
      filingLimitDays: 30
    });
    for (const [c, [fixture, options]] of Object.entries(CASES)) {
      await uploadEncounters(s, pcrs[c as Case], fixture, options);
      claims[c as Case] = await draftClaim(s, pcrs[c as Case]);
    }
  });

  after(async () => {
    await s?.browser.close();
  });

  it('reminds a biller once that timely filing for a payer has passed', async () => {
    const built = await reviewed(s, claims.deadline);
    assert.deepEqual(
      built.claim.coverages.map((c) => c.payer),
      [late.name]
    );
    await runWorkflow('billing.watch-deadlines', 'Watch Deadlines');
    const [reminder] = await until(
      s.page,
      () => reminders(claims.deadline),
      (r) => r.length === 1,
      'a Deadline coming up task'
    );
    await go(s.page, `/tasks/${reminder?.id}`);
    await s.page
      .getByText(/The filing limit passed on/)
      .first()
      .waitFor();
    await runWorkflow('billing.watch-deadlines', 'Watch Deadlines');
    assert.equal((await reminders(claims.deadline)).length, 1, 'no second reminder');
    await workTask(s, claims.deadline, step('Deadline coming up', 'Done'), ['Review claim']);
  });

  it("invoices a contract facility for last month's trips and files the invoice on the claim", async () => {
    await workUntil(
      s,
      claims.invoiced,
      [...REVIEW_PCR, step('Bill facility', 'Bill Facility')],
      'facility_billing'
    );
    await runWorkflow('billing.invoice-facilities', 'Invoice Facilities');
    await eventLogged(s, claims.invoiced, 'facility_invoiced');
    const { files } = await claimState(s, claims.invoiced);
    const invoice = files.find((f) => f.kind === 'facility_invoiced' && f.has_document);
    assert.ok(invoice, 'the invoice is in the claim files');
    const body = await apiText(s, `/api/claims/${claims.invoiced}/events/${invoice.id}/document`);
    assert.match(body, /^%PDF/);
  });

  it('chases a missing certification until it arrives', async () => {
    await reviewed(s, claims.chased);
    await startClaimTask(s, claims.chased, 'Chase Document');
    const kind = listboxByLabel(decision(s.page), /^Document\b/);
    await until(
      s.page,
      async () => {
        if ((await chosenValue(kind)) !== 'pcs') await chooseOption(kind, 'pcs');
        return chosenValue(kind);
      },
      (v) => v === 'pcs',
      'the certification to be chosen'
    );
    await decide(s.page, 'Start Chase');
    const chase = await claimIs(
      s,
      claims.chased,
      (c) => c.claim.tasks.some((t) => t.title === 'Chase document'),
      'a Chase document task'
    );
    const id = chase.claim.tasks.find((t) => t.title === 'Chase document')?.id;
    const { task } = await api<{ task: { queue: string; due_at: string | null } }>(
      s,
      `/api/tasks/${id}`
    );
    assert.equal(task.queue, 'billing-documents');
    assert.ok(task.due_at, 'the chase is due by a date');
    await workTask(
      s,
      claims.chased,
      step('Chase document', 'Received', async (d) => {
        await d.getByLabel(/^Signed On/i).fill('2026-09-01');
        await d.getByLabel(/^File/).setInputFiles(pdf('chased-pcs.pdf'));
        await d.getByText('Uploaded chased-pcs.pdf').waitFor();
      }),
      ['Review claim']
    );
    await claimIs(
      s,
      claims.chased,
      (c) => c.documents.some((d) => d.file_name === 'chased-pcs.pdf'),
      'the certification on file'
    );
  });

  it('bills a directory facility instead of the payers when the biller says it is responsible', async () => {
    await reviewed(s, claims.facility);
    const riverside = await idOf('/api/facilities', 'Riverside Rehabilitation Center');
    await startClaimTask(s, claims.facility, 'Change Responsible Party');
    await chooseOption(listboxByLabel(decision(s.page), /^Responsible Facility/i), riverside);
    await decide(s.page, 'Bill Facility');
    await claimIs(
      s,
      claims.facility,
      (c) => c.claim.facility_id === riverside,
      'the facility recorded'
    );
    const billed = await workUntil(s, claims.facility, [approve], 'facility_billing');
    assert.equal(billed.claim.facility_id, riverside);
  });

  it('restarts a payer cycle that was cancelled', async () => {
    const built = await reviewed(s, claims.restarted);
    const cycle = (built.claim as unknown as { cycle_run_id: string }).cycle_run_id;
    await go(s.page, `/runs/${cycle}`);
    await s.page.getByRole('button', { name: 'Cancel Run' }).click();
    await s.page
      .getByRole('dialog', { name: 'Cancel Run?' })
      .getByRole('button', { name: 'Cancel Run' })
      .click();
    await claimIs(
      s,
      claims.restarted,
      (c) => c.claim.tasks.length === 0,
      'the review task to close'
    );
    await openClaim(s, claims.restarted);
    await s.page
      .getByText(/was cancelled/)
      .first()
      .waitFor();
    await claimAction(s.page, 'Restart Payer Cycle');
    await toast(s.page, 'Payer cycle restarted');
    await claimIs(
      s,
      claims.restarted,
      (c) => c.claim.tasks.some((t) => t.title === 'Review claim'),
      'the restarted cycle to ask for review again'
    );
  });
});
