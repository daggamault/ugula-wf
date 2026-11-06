import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import { chooseOption, chosenValue, listboxByLabel } from './shared/listbox.ts';
import {
  claimState,
  claimStatusIs,
  completeTask,
  config,
  decide,
  FLOW_MS,
  finishTask,
  go,
  heading,
  importEncounter,
  type Session,
  SUITE_MS,
  section,
  signIn,
  startClaimTask,
  toasts,
  uniqueId,
  until
} from './shared/session.ts';

const LAST_NAME = 'Kline';
const BIRTH_DATE = '1941-05-22';
const OPTIONAL_TASKS = ['Match payer', 'Confirm patient'];

let s: Session;
const pcrs = {
  worked: uniqueId('E2E-CLM'),
  held: uniqueId('E2E-CLM'),
  voided: uniqueId('E2E-CLM')
};
const claims = { worked: '', held: '', voided: '' };

const reach = (claimId: string, title: string) =>
  until(
    s.page,
    async () => {
      const { claim } = await claimState(s, claimId);
      const optional = claim.tasks.find((t) => OPTIONAL_TASKS.includes(t.title));
      if (optional && optional.title !== title) {
        await completeTask(s, claimId, optional.title);
        return undefined;
      }
      return claim.tasks.find((t) => t.title === title);
    },
    (t) => t !== undefined,
    `a "${title}" task`
  );

const openTaskPage = async (claimId: string, title: string) => {
  const task = await reach(claimId, title);
  await go(s.page, `/tasks/${task?.id}`);
  await section(s.page, 'Your Decision').last().waitFor();
  return task?.id ?? '';
};

const openClaim = async (claimId: string, tab = '') => {
  await go(s.page, `/claims/${claimId}${tab ? `?tab=${tab}` : ''}`);
  await heading(s.page, /^Claim \d{8}-\d{4,}$/).waitFor();
};

const toast = (title: string | RegExp) => toasts(s.page).getByText(title).first().waitFor();

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

const claimRow = (pcr: string) => s.page.getByRole('row').filter({ hasText: pcr });

const fillNote = async (page: Page, note: string) => {
  await section(page, 'Your Decision').last().getByLabel('Note').fill(note);
};

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
      assert.equal(await page.getByRole('heading', { level: 1, name: 'Claims' }).count(), 0);
      await page.getByLabel('Password').fill(config.DEV_USER_PASSWORD);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.getByRole('heading', { level: 1, name: 'Claims' }).waitFor();
      await page.getByRole('button', { name: 'Sign Out' }).click();
      await page.getByText('Sign In to Your Account').waitFor();
      await page.goto(new URL(`/agencies/${s.agencyId}/claims`, config.E2E_WEB_URL).href);
      await page.getByLabel('Password').waitFor();
    } finally {
      await context.close();
    }
  });

  it('searches claims by encounter number and patient', async () => {
    for (const claimId of Object.values(claims)) await reach(claimId, 'Review PCR');
    await searchClaims({ Number: pcrs.worked });
    await claimRow(pcrs.worked).waitFor();
    assert.equal(await claimRow(pcrs.held).count(), 0);
    await searchClaims({ Number: `${pcrs.worked}-none` });
    await s.page.getByRole('heading', { name: 'No Matching Claims' }).waitFor();
    await searchClaims({ 'Last Name': LAST_NAME, 'Birth Date': BIRTH_DATE });
    await claimRow(pcrs.held).waitFor();
    await claimRow(pcrs.voided).waitFor();
  });

  it('opens the waiting task from the tasks list, not from its claim', async () => {
    await reach(claims.worked, 'Review PCR');
    const { claim } = await claimState(s, claims.worked);
    await searchClaims({ Number: pcrs.worked });
    await claimRow(pcrs.worked).waitFor();
    assert.equal(
      await claimRow(pcrs.worked)
        .getByRole('link', { name: /^Work / })
        .count(),
      0
    );
    await go(s.page, `/tasks?q=${encodeURIComponent(claim.number)}`);
    const row = s.page.getByRole('row').filter({ hasText: claim.number });
    await row.getByRole('link', { name: /^Open task Review PCR/ }).click();
    await section(s.page, 'Your Decision').last().waitFor();
    assert.match(s.page.url(), /\/tasks\//);
  });

  it('assigns a task, shows its details, and blocks an outcome until required fields are set', async () => {
    await openTaskPage(claims.worked, 'Review PCR');
    await s.page.getByRole('button', { name: 'Assign to Me' }).click();
    await toast('Assigned to you');
    await s.page.getByRole('button', { name: 'Unassign' }).click();
    await toast('Unassigned');
    await section(s.page, 'The Issue').first().waitFor();
    for (const title of ['Summary', 'Charges', 'Claim Data', 'Documentation', 'Payers']) {
      await section(s.page, title).first().waitFor();
    }
    const tabs = s.page.getByRole('navigation', { name: 'Task data' });
    await tabs.getByRole('link', { name: 'Encounter' }).click();
    await section(s.page, 'Patient Care Report')
      .getByText(/What the crew documented/)
      .waitFor();
    await tabs.getByRole('link', { name: 'Patient' }).click();
    await section(s.page, 'Patient Record').first().waitFor();
    assert.match(s.page.url(), /[?&]tab=patient/);
    await tabs.getByRole('link', { name: 'Workflow' }).click();
    await section(s.page, 'Workflow Details').first().waitFor();
    await tabs.getByRole('link', { name: 'Claim' }).click();
    const decision = section(s.page, 'Your Decision').last();
    for (const option of await decision
      .getByRole('list', { name: 'Options' })
      .locator('button[name="outcome"]')
      .all()) {
      const ids = ((await option.getAttribute('aria-describedby')) ?? '').split(' ');
      const hint = ids.find((id) => id.startsWith('outcome-'));
      assert.ok(hint, `${await option.textContent()} says what it does`);
      assert.ok(((await s.page.locator(`[id="${hint}"]`).textContent()) ?? '').length > 10);
    }
    const level = listboxByLabel(decision, /^Level of Service/i);
    const chosen = await chosenValue(level);
    await chooseOption(level, '');
    const approve = decision.getByRole('button', { name: 'Approve' });
    assert.equal(await approve.getAttribute('aria-disabled'), 'true');
    const described = ((await approve.getAttribute('aria-describedby')) ?? '').split(' ');
    const reasons = await Promise.all(
      described.map(async (id) => (await s.page.locator(`[id="${id}"]`).textContent()) ?? '')
    );
    assert.ok(reasons.some((r) => /Fill in Level of Service/i.test(r)));
    await chooseOption(level, chosen);
    assert.equal(await approve.getAttribute('aria-disabled'), null);
  });

  it('holds a PCR with a note and releases it back to review', async () => {
    await openTaskPage(claims.held, 'Review PCR');
    await fillNote(s.page, 'E2E hold: waiting on signature');
    await decide(s.page, 'Hold');
    await openTaskPage(claims.held, 'Held PCR');
    await s.page.getByText('E2E hold: waiting on signature').first().waitFor();
    await searchClaims({ Number: pcrs.held });
    await claimRow(pcrs.held).getByText('Held PCR').first().waitFor();
    await openTaskPage(claims.held, 'Held PCR');
    await decide(s.page, 'Release');
    await reach(claims.held, 'Review PCR');
  });

  it('holds a PCR and voids it, closing its claim as void', async () => {
    await openTaskPage(claims.voided, 'Review PCR');
    await fillNote(s.page, 'E2E duplicate trip');
    await decide(s.page, 'Hold');
    await openTaskPage(claims.voided, 'Held PCR');
    await decide(s.page, 'Void');
    await claimStatusIs(s, claims.voided, 'void');
    await searchClaims({ Number: pcrs.voided });
    await claimRow(pcrs.voided).getByText('Void').first().waitFor();
  });

  it('builds a claim and shows its summary, charges, documentation, eligibility and payers', async () => {
    await completeTask(s, claims.worked, 'Review PCR');
    await claimStatusIs(s, claims.worked, 'needs_review');
    await openClaim(claims.worked);
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
      .waitFor({ timeout: FLOW_MS });
  });

  it('sends a claim from review to a Fix Claim Data task and back, saying where each option leads', async () => {
    await openTaskPage(claims.worked, 'Review claim');
    const fix = section(s.page, 'Your Decision')
      .last()
      .getByRole('button', { name: 'Fix Claim Data' });
    const hintId = ((await fix.getAttribute('aria-describedby')) ?? '')
      .split(' ')
      .find((id) => id.startsWith('outcome-'));
    assert.match(
      (await s.page.locator(`[id="${hintId}"]`).textContent()) ?? '',
      /Fix Claim Data task/
    );
    await decide(s.page, 'Fix Claim Data');
    const next = s.page.getByRole('link', { name: /^Open Fix claim data/i });
    await next.waitFor({ timeout: FLOW_MS });
    await next.click();
    const decision = section(s.page, 'Your Decision').last();
    await decision.getByText('Fields start with the current values').waitFor();
    await decision.getByText('No Changes Yet').waitFor();
    await finishTask(s.page, 'Back to Review');
    await reach(claims.worked, 'Review claim');
  });

  it('corrects documentation with a Correct Claim Data task and shows it on the overview', async () => {
    await openClaim(claims.worked);
    await startClaimTask(s.page, 'Correct Claim Data');
    const decision = section(s.page, 'Your Decision').last();
    await chooseOption(listboxByLabel(decision, /^Ambulance Transport Reason/i), 'D');
    await decision
      .getByText(/^Changed from/)
      .first()
      .waitFor();
    const changes = decision.getByRole('region', { name: 'Your changes' });
    await changes.getByText('Ambulance Transport Reason').waitFor();
    await changes
      .getByText(/specialist or equipment/)
      .first()
      .waitFor();
    await finishTask(s.page, 'Save');
    await until(
      s.page,
      async () => (await claimState(s, claims.worked)).claim.transport_reason,
      (reason) => reason === 'D',
      'the transport reason to be D'
    );
    await openClaim(claims.worked);
    await section(s.page, 'Documentation')
      .getByText(/^D · For a specialist or equipment/)
      .waitFor();
  });

  it('adds, reorders and removes a payer with Change Payers tasks', async () => {
    const order = async () =>
      (await claimState(s, claims.worked)).claim.coverages.map((c) => c.payer);
    const change = async (names: string[]) => {
      await openClaim(claims.worked);
      await startClaimTask(s.page, 'Change Payers');
      await section(s.page, 'Your Decision')
        .last()
        .getByLabel(/^Payers/)
        .fill(names.join('\n'));
      await finishTask(s.page, 'Save');
    };
    const [first = ''] = await order();
    await change([first, 'Blue Plan']);
    await until(s.page, order, (o) => o.join() === `${first},Blue Plan`, 'Blue Plan added second');
    await change(['Blue Plan', first]);
    await until(s.page, order, (o) => o[0] === 'Blue Plan', 'Blue Plan moved first');
    await change([first]);
    await until(s.page, order, (o) => o.join() === first, 'Blue Plan removed');
  });

  it('adds a document and logs a records request through their tasks', async () => {
    await openClaim(claims.worked);
    await startClaimTask(s.page, 'Add Document');
    const upload = section(s.page, 'Your Decision').last();
    await chooseOption(listboxByLabel(upload, /^Document\b/), 'facesheet');
    await upload.locator('input[type="file"]').setInputFiles({
      name: 'facesheet.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
    });
    await upload.getByText('Uploaded facesheet.pdf').waitFor();
    await finishTask(s.page, 'Add Document');
    await until(
      s.page,
      () => claimState(s, claims.worked),
      (c) => c.documents.some((d) => d.file_name === 'facesheet.pdf'),
      'the facesheet on the claim'
    );
    await openClaim(claims.worked);
    await section(s.page, 'Documents').getByText('Facesheet: facesheet.pdf').waitFor();
    await startClaimTask(s.page, 'Log Records Request');
    await section(s.page, 'Your Decision')
      .last()
      .getByLabel(/^Records Requested/i)
      .fill('PCS and facesheet');
    await finishTask(s.page, 'Log Request');
    await reach(claims.worked, 'Send records');
  });

  it('files a claim once it is reviewed, posts a payment with a Post Payment task and lowers the balance', async () => {
    await completeTask(s, claims.worked, 'Review claim', { outcome: 'Approve' });
    const { claim } = await claimStatusIs(s, claims.worked, 'submitted');
    await openClaim(claims.worked);
    await startClaimTask(s.page, 'Post Payment');
    const payment = section(s.page, 'Your Decision').last();
    await payment.getByLabel(/^Paid or Refunded/i).fill('100.00');
    await payment.getByLabel(/^Adjusted/i).fill('50.00');
    await payment.getByLabel(/^Paid On$/i).fill('2026-10-20');
    await payment.getByLabel(/^Reason Codes/i).fill('CO-45 50.00');
    await finishTask(s.page, 'Post Payment');
    const balanceOf = async () =>
      (
        await s.page.request
          .get(`${s.apiUrl}/api/agencies/${s.agencyId}/claims/${claims.worked}`)
          .then((r) => r.json())
      ).claim.balance_cents as number;
    await until(
      s.page,
      balanceOf,
      (b) => b === claim.total_cents - 15_000,
      'the balance to drop by $150'
    );
  });

  it('lists every event on the claim history tab', async () => {
    await openClaim(claims.worked, 'history');
    for (const event of ['Approved for submission', 'Submitted', 'Response', 'Claim data edited']) {
      await s.page.getByRole('cell', { name: event }).first().waitFor();
    }
  });

  it('finds the patient by name and birth date and lists their claims', async () => {
    await go(s.page, '/patients');
    const form = s.page.getByRole('search', { name: 'Search patients' });
    await form.getByLabel('Last Name').fill('kli');
    await form.getByLabel('Birth Date').fill(BIRTH_DATE);
    await form.getByRole('button', { name: 'Search' }).click();
    await s.page.getByRole('link', { name: 'Open patient Kline, Dorothy' }).first().click();
    await section(s.page, 'Details').first().waitFor();
    const { claim } = await claimState(s, claims.worked);
    await s.page.getByRole('row').filter({ hasText: claim.number }).first().waitFor();
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
