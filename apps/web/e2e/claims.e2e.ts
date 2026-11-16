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
  openClaim,
  REVIEW_PCR,
  startClaimTask,
  step,
  uploadPayerFile,
  work,
  workTask,
  workUntil
} from './shared/claims.ts';
import { chooseOption, chosenValue, listboxByLabel } from './shared/listbox.ts';
import {
  config,
  go,
  heading,
  rowWith,
  type Session,
  SUITE_MS,
  section,
  signIn,
  submitSignIn,
  toast,
  uniqueId,
  until
} from './shared/session.ts';
import { eligibility271 } from './shared/x12.ts';

let s: Session;
const pcrs = {
  worked: uniqueId('E2E-CLM'),
  held: uniqueId('E2E-CLM'),
  voided: uniqueId('E2E-CLM')
};
const claims = { worked: '', held: '', voided: '' };

const openTask = async (claimId: string, title: string) => {
  const c = await claimIs(
    s,
    claimId,
    (c) => c.claim.tasks.some((t) => t.title === title),
    `a "${title}" task`
  );
  const task = c.claim.tasks.find((t) => t.title === title);
  await go(s.page, `/tasks/${task?.id}`);
  await decision(s.page).waitFor();
  return task?.id ?? '';
};

const searchClaims = async (fields: Record<string, string>) => {
  await go(s.page, '/claims');
  const form = s.page.getByRole('search', { name: 'Search claims' });
  await form.waitFor();
  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
  await form.getByRole('button', { name: 'Search' }).click();
  await s.page.waitForURL(/\/claims\?/);
};

const fillNote = (note: string) => decision(s.page).getByLabel('Note').fill(note);

describe('a biller works claims, tasks and patients', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    claims.worked = await importEncounter(s, pcrs.worked);
    claims.held = await importEncounter(s, pcrs.held);
    claims.voided = await importEncounter(s, pcrs.voided);
  });

  after(async () => {
    await s?.browser.close();
  });

  it('refuses a wrong password and signs out back to the sign-in form', async () => {
    const context = await s.browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(new URL(`/agencies/${s.agencyId}/claims`, config.E2E_WEB_URL).href);
      await page.getByLabel('Email').fill(config.DEV_USER_EMAIL);
      await page.getByLabel('Password').fill(`${config.DEV_USER_PASSWORD}-wrong`);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.getByRole('alert').first().waitFor();
      assert.equal(await heading(page, 'Claims').count(), 0);
      await page.getByLabel('Password').fill(config.DEV_USER_PASSWORD);
      await submitSignIn(page);
      await heading(page, 'Claims').waitFor();
      await page.getByRole('button', { name: 'Sign Out' }).click();
      await page.getByText('Sign In to Your Account').waitFor();
      await page.goto(new URL(`/agencies/${s.agencyId}/claims`, config.E2E_WEB_URL).href);
      await page.getByLabel('Password').waitFor();
    } finally {
      await context.close();
    }
  });

  it('searches claims by encounter number and patient', async () => {
    for (const claimId of Object.values(claims)) await openTask(claimId, 'Review PCR');
    await searchClaims({ Number: pcrs.worked });
    await rowWith(s.page, pcrs.worked).waitFor();
    assert.equal(await rowWith(s.page, pcrs.held).count(), 0);
    await searchClaims({ Number: `${pcrs.worked}-none` });
    await s.page.getByRole('heading', { name: 'No Matching Claims' }).waitFor();
    const { claim } = await claimState(s, claims.held);
    await searchClaims({
      'Last Name': claim.last_name ?? '',
      'Birth Date': claim.birth_date?.slice(0, 10) ?? ''
    });
    await rowWith(s.page, pcrs.held).waitFor();
    assert.equal(await rowWith(s.page, pcrs.voided).count(), 0);
  });

  it('opens the waiting task from the tasks list, not from its claim', async () => {
    const { claim } = await claimState(s, claims.worked);
    await searchClaims({ Number: pcrs.worked });
    await rowWith(s.page, pcrs.worked).waitFor();
    assert.equal(
      await rowWith(s.page, pcrs.worked)
        .getByRole('link', { name: /^Work / })
        .count(),
      0
    );
    await go(s.page, `/tasks?q=${encodeURIComponent(claim.number)}`);
    await rowWith(s.page, claim.number)
      .getByRole('link', { name: /^Open task Review PCR/ })
      .click();
    await decision(s.page).waitFor();
    assert.match(s.page.url(), /\/tasks\//);
  });

  it('filters the work queue by queue and assignee', async () => {
    const { claim } = await claimState(s, claims.worked);
    await openTask(claims.worked, 'Review PCR');
    await s.page.getByRole('button', { name: 'Assign to Me' }).click();
    await toast(s.page, 'Assigned to you');
    await go(s.page, '/tasks');
    await heading(s.page, 'Tasks').waitFor();
    await chooseOption(listboxByLabel(s.page, 'Assignee'), 'mine');
    await s.page.waitForURL(/assignee=mine/);
    await rowWith(s.page, claim.number).waitFor();
    const queue = listboxByLabel(s.page, 'Queue');
    await chooseOption(queue, 'billing-review');
    await s.page.waitForURL(/queue=billing-review/);
    await rowWith(s.page, claim.number).waitFor();
    await chooseOption(listboxByLabel(s.page, 'Assignee'), 'unassigned');
    await s.page.waitForURL(/assignee=unassigned/);
    await until(
      s.page,
      () => rowWith(s.page, claim.number).count(),
      (n) => n === 0,
      'my task to leave the unassigned list'
    );
    await openTask(claims.worked, 'Review PCR');
    await s.page.getByRole('button', { name: 'Unassign' }).click();
    await toast(s.page, 'Unassigned');
  });

  it('shows a task with its details, and blocks an outcome until required fields are set', async () => {
    await openTask(claims.worked, 'Review PCR');
    await section(s.page, 'The Issue').first().waitFor();
    for (const title of ['Summary', 'Charges', 'Claim Data', 'Documentation', 'Payers']) {
      await section(s.page, title).first().waitFor();
    }
    const tabs = s.page.getByRole('navigation', { name: 'Task data' });
    await tabs.getByRole('link', { name: 'Encounter' }).click();
    await section(s.page, 'Patient Care Report')
      .getByText(/received/)
      .waitFor();
    await tabs.getByRole('link', { name: 'Patient' }).click();
    await section(s.page, 'Patient Record').first().waitFor();
    assert.match(s.page.url(), /[?&]tab=patient/);
    await tabs.getByRole('link', { name: 'Workflow' }).click();
    await section(s.page, 'Workflow Details').first().waitFor();
    await tabs.getByRole('link', { name: 'Claim' }).click();
    const d = decision(s.page);
    for (const name of ['Approve', 'Hold']) {
      const option = d.getByRole('button', { name, exact: true });
      const ids = ((await option.getAttribute('aria-describedby')) ?? '').split(' ');
      const hint = ids.find((id) => id.startsWith('outcome-'));
      assert.ok(hint, `${name} says what it does`);
      assert.ok(((await s.page.locator(`[id="${hint}"]`).textContent()) ?? '').length > 10);
    }
    const level = listboxByLabel(d, /^Level of Service/i);
    const chosen = await chosenValue(level);
    await chooseOption(level, '');
    const approveButton = d.getByRole('button', { name: 'Approve' });
    assert.equal(await approveButton.getAttribute('aria-disabled'), 'true');
    const described = ((await approveButton.getAttribute('aria-describedby')) ?? '').split(' ');
    const reasons = await Promise.all(
      described.map(async (id) => (await s.page.locator(`[id="${id}"]`).textContent()) ?? '')
    );
    assert.ok(reasons.some((r) => /Fill in Level of Service/i.test(r)));
    await chooseOption(level, chosen);
    assert.equal(await approveButton.getAttribute('aria-disabled'), null);
  });

  it('holds a PCR with a note, moves on with Next Task and releases it back to review', async () => {
    await workTask(
      s,
      claims.held,
      step('Review PCR', 'Hold', () => fillNote('E2E hold: waiting on signature'))
    );
    const done = s.page.url();
    await s.page.getByRole('button', { name: 'Next Task' }).click();
    await s.page.waitForURL((u) => /\/tasks\/[^/?]+/.test(u.pathname) && u.href !== done);
    await decision(s.page).waitFor();
    await openTask(claims.held, 'Held PCR');
    await s.page.getByText('E2E hold: waiting on signature').first().waitFor();
    await searchClaims({ Number: pcrs.held });
    await rowWith(s.page, pcrs.held).getByText('Held PCR').first().waitFor();
    await workTask(s, claims.held, step('Held PCR', 'Release'));
    await openTask(claims.held, 'Review PCR');
  });

  it('holds a PCR and voids it, closing its claim as void', async () => {
    await work(
      s,
      claims.voided,
      [step('Review PCR', 'Hold', () => fillNote('E2E duplicate trip')), step('Held PCR', 'Void')],
      (c) => c.claim.status === 'void',
      'the claim to be void'
    );
    await searchClaims({ Number: pcrs.voided });
    await rowWith(s.page, pcrs.voided).getByText('Void').first().waitFor();
  });

  it('builds a claim and shows its summary, charges, documentation, eligibility and payers', async () => {
    const built = await workUntil(s, claims.worked, REVIEW_PCR, 'needs_review');
    const [coverage] = built.claim.coverages;
    assert.ok(coverage);
    await uploadPayerFile(s.page, `${pcrs.worked}.271`, eligibility271(coverage.id, true));
    await openClaim(s, claims.worked);
    for (const title of ['Summary', 'Charges', 'Documentation', 'Eligibility', 'Payers']) {
      await section(s.page, title).first().waitFor();
    }
    await section(s.page, 'Charges')
      .getByText(/A04\d\d/)
      .first()
      .waitFor();
    await section(s.page, 'Eligibility')
      .getByRole('row')
      .filter({ hasText: 'Medicare' })
      .getByText('Active', { exact: true })
      .waitFor();
  });

  it('sends a claim from review to a Fix Claim Data task and back, saying where each option leads', async () => {
    await openTask(claims.worked, 'Review claim');
    const fix = decision(s.page).getByRole('button', { name: 'Fix Claim Data' });
    const hintId = ((await fix.getAttribute('aria-describedby')) ?? '')
      .split(' ')
      .find((id) => id.startsWith('outcome-'));
    assert.match(
      (await s.page.locator(`[id="${hintId}"]`).textContent()) ?? '',
      /Fix Claim Data task/
    );
    await decide(s.page, 'Fix Claim Data');
    const next = s.page.getByRole('link', { name: /^Open Fix claim data/i });
    await next.waitFor({ timeout: config.E2E_FLOW_MS });
    await next.click();
    const d = decision(s.page);
    await d.getByText('Fields start with the current values').waitFor();
    await d.getByText('No Changes Yet').waitFor();
    await decide(s.page, 'Back to Review');
    await openTask(claims.worked, 'Review claim');
  });

  it('corrects documentation with a Correct Claim Data task and shows it on the overview', async () => {
    await startClaimTask(s, claims.worked, 'Correct Claim Data');
    const d = decision(s.page);
    await chooseOption(listboxByLabel(d, /^Ambulance Transport Reason/i), 'D');
    await d
      .getByText(/^Changed from/)
      .first()
      .waitFor();
    const changes = d.getByRole('region', { name: 'Your changes' });
    await changes.getByText('Ambulance Transport Reason').waitFor();
    await changes
      .getByText(/specialist or equipment/)
      .first()
      .waitFor();
    await decide(s.page, 'Save');
    await claimIs(s, claims.worked, (c) => c.claim.transport_reason === 'D', 'transport reason D');
    await openClaim(s, claims.worked);
    await section(s.page, 'Documentation')
      .getByText(/^D · For a specialist or equipment/)
      .waitFor();
  });

  it('adds, reorders and removes a payer with Change Responsible Party tasks', async () => {
    const order = async () =>
      (await claimState(s, claims.worked)).claim.coverages.map((c) => c.payer);
    const change = async (names: string[]) => {
      await startClaimTask(s, claims.worked, 'Change Responsible Party');
      await decision(s.page)
        .getByLabel(/^Payers/)
        .fill(names.join('\n'));
      await decide(s.page, 'Save');
    };
    const [first = ''] = await order();
    await change([first, 'Blue Plan']);
    await until(s.page, order, (o) => o.join() === `${first},Blue Plan`, 'Blue Plan added second');
    await change(['Blue Plan', first]);
    await until(s.page, order, (o) => o[0] === 'Blue Plan', 'Blue Plan moved first');
    await change([first]);
    await until(s.page, order, (o) => o.join() === first, 'Blue Plan removed');
  });

  it('adds a document through its task and lists it on the claim', async () => {
    await startClaimTask(s, claims.worked, 'Add Document');
    const upload = decision(s.page);
    await chooseOption(listboxByLabel(upload, /^Document\b/), 'facesheet');
    await upload.getByLabel(/^File/).setInputFiles({
      name: 'facesheet.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
    });
    await upload.getByText('Uploaded facesheet.pdf').waitFor();
    await decide(s.page, 'Add Document');
    await claimIs(
      s,
      claims.worked,
      (c) => c.documents.some((d) => d.file_name === 'facesheet.pdf'),
      'the facesheet on the claim'
    );
    await openClaim(s, claims.worked);
    await section(s.page, 'Documents').getByText('Facesheet: facesheet.pdf').waitFor();
  });

  it('logs a records request and marks the records sent', async () => {
    await startClaimTask(s, claims.worked, 'Log Records Request');
    await decision(s.page)
      .getByLabel(/^Records Requested/i)
      .fill('PCS and facesheet');
    await decide(s.page, 'Log Request');
    await eventLogged(s, claims.worked, 'records_requested');
    await workTask(s, claims.worked, step('Send records', 'Mark Sent'), ['Review claim']);
    await eventLogged(s, claims.worked, 'records_sent');
  });

  it('files a claim once it is reviewed, posts a payment with a Post Payment task and lowers the balance', async () => {
    await fileClaim(s, claims.worked, [approve]);
    const { claim } = await claimStatusIs(s, claims.worked, 'submitted');
    await startClaimTask(s, claims.worked, 'Post Payment');
    const payment = decision(s.page);
    await payment.getByLabel(/^Paid or Refunded/i).fill('100.00');
    await payment.getByLabel(/^Paid On$/i).fill('2026-10-20');
    await payment.getByLabel(/^Reason Codes/i).fill('CO-45 50.00');
    await decide(s.page, 'Post Payment');
    await claimIs(
      s,
      claims.worked,
      (c) => c.claim.balance_cents === claim.total_cents - 15_000,
      'the balance to drop by $150'
    );
  });

  it('lists every event on the claim history tab', async () => {
    await openClaim(s, claims.worked, 'history');
    for (const event of ['Approved for submission', 'Submitted', 'Claim data edited']) {
      await s.page.getByRole('cell', { name: event }).first().waitFor();
    }
    assert.ok(
      (await claimEvents(s, claims.worked)).some(
        (e) => e.kind === 'response' && e.paid_cents === 10_000
      )
    );
  });

  it('finds the patient by name and birth date and lists their claims', async () => {
    const { claim } = await claimState(s, claims.worked);
    await go(s.page, '/patients');
    const form = s.page.getByRole('search', { name: 'Search patients' });
    await form.getByLabel('Last Name').fill(claim.last_name?.slice(0, 8) ?? '');
    await form.getByLabel('Birth Date').fill(claim.birth_date?.slice(0, 10) ?? '');
    await form.getByRole('button', { name: 'Search' }).click();
    await s.page
      .getByRole('link', { name: `Open patient ${claim.last_name}, ${claim.first_name}` })
      .click();
    await section(s.page, 'Details').first().waitFor();
    await rowWith(s.page, claim.number).first().waitFor();
  });

  it('keeps new tasks in the notification bell and clears them', async () => {
    await go(s.page, '/claims');
    await s.page
      .getByRole('button', { name: /^Notifications/ })
      .first()
      .click();
    const panel = s.page.getByRole('dialog', { name: 'Notifications' });
    const first = panel.getByText(/New task:/).first();
    await first.waitFor();
    const cleared = (await first.textContent()) ?? '';
    await panel.getByRole('button', { name: 'Clear All' }).click();
    await until(
      s.page,
      async () => panel.getByText(cleared, { exact: true }).count(),
      (n) => n === 0,
      'the notifications to clear'
    );
    await s.page.keyboard.press('Escape');
  });
});
