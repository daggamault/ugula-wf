import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import {
  claimState,
  claimStatusIs,
  completeTask,
  config,
  decide,
  go,
  heading,
  importEncounter,
  type Session,
  SUITE_MS,
  section,
  signIn,
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
  await heading(s.page, /^Claim #\d+$/).waitFor();
};

const toast = (title: string | RegExp) => toasts(s.page).getByText(title).first().waitFor();

const filterClaims = async (fields: Record<string, string>, status = 'all') => {
  await go(s.page, '/claims');
  const form = s.page.getByRole('search', { name: 'Filter claims' });
  await form.waitFor();
  for (const [label, value] of Object.entries(fields)) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
  await form.getByLabel('Status', { exact: true }).selectOption(status);
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
      await page.goto(new URL('/claims', config.E2E_WEB_URL).href);
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
      await page.goto(new URL('/claims', config.E2E_WEB_URL).href);
      await page.getByLabel('Password').waitFor();
    } finally {
      await context.close();
    }
  });

  it('filters claims by encounter number, status and patient', async () => {
    await reach(claims.worked, 'Review PCR');
    await filterClaims({ Number: pcrs.worked });
    await claimRow(pcrs.worked).waitFor();
    assert.equal(await claimRow(pcrs.held).count(), 0);
    await filterClaims({ Number: pcrs.worked }, 'paid');
    await s.page.getByRole('heading', { name: 'No Matching Claims' }).waitFor();
    await filterClaims({ 'Last Name': LAST_NAME, 'Birth Date': BIRTH_DATE });
    await claimRow(pcrs.held).waitFor();
    await claimRow(pcrs.voided).waitFor();
    const toggle = s.page.getByRole('button', { name: /^Filters/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  });

  it('opens the waiting task from its claim row', async () => {
    await reach(claims.worked, 'Review PCR');
    await filterClaims({ Number: pcrs.worked });
    const row = claimRow(pcrs.worked);
    await row.getByText('Review PCR').waitFor();
    await row.getByRole('link', { name: /^Work Review PCR on claim #\d+$/ }).click();
    await section(s.page, 'Your Decision').last().waitFor();
    assert.match(s.page.url(), /\/tasks\//);
  });

  it('assigns a task, shows its details, and blocks an outcome until required fields are set', async () => {
    await openTaskPage(claims.worked, 'Review PCR');
    await s.page.getByRole('button', { name: 'Assign to Me' }).click();
    await toast('Assigned to you');
    await s.page.getByRole('button', { name: 'Unassign' }).click();
    await toast('Unassigned');
    await section(s.page, 'Details').first().waitFor();
    const decision = section(s.page, 'Your Decision').last();
    const level = decision.getByLabel(/^Level of Service/i);
    const chosen = await level.inputValue();
    await level.selectOption('');
    const approve = decision.getByRole('button', { name: 'Approve' });
    assert.equal(await approve.getAttribute('aria-disabled'), 'true');
    const reason = await approve.getAttribute('aria-describedby');
    assert.match(
      (await s.page.locator(`[id="${reason}"]`).textContent()) ?? '',
      /Fill in Level of Service/i
    );
    await level.selectOption(chosen);
    assert.equal(await approve.getAttribute('aria-disabled'), null);
  });

  it('holds a PCR with a note and releases it back to review', async () => {
    await openTaskPage(claims.held, 'Review PCR');
    await fillNote(s.page, 'E2E hold: waiting on signature');
    await decide(s.page, 'Hold');
    await openTaskPage(claims.held, 'Held PCR');
    await s.page.getByText('E2E hold: waiting on signature').first().waitFor();
    await filterClaims({ Number: pcrs.held });
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
    await filterClaims({ Number: pcrs.voided }, 'void');
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
    await section(s.page, 'Eligibility').getByText('Not Checked').waitFor();
  });

  it('edits documentation on the claim data tab and shows it on the overview', async () => {
    await openClaim(claims.worked, 'data');
    const form = s.page.getByRole('form', { name: 'Claim data' });
    await form.getByLabel('Transport Reason').selectOption('D');
    await form.getByRole('button', { name: 'Save Claim Data' }).click();
    await toast('Billing details saved');
    await openClaim(claims.worked);
    await section(s.page, 'Documentation')
      .getByText(/^D · For a specialist or equipment/)
      .waitFor();
  });

  it('adds, reorders and removes a payer on the claim', async () => {
    const order = async () =>
      (await claimState(s, claims.worked)).claim.coverages.map((c) => c.payer);
    const save = async () => {
      await section(s.page, 'Payers').getByRole('button', { name: 'Save Payers' }).click();
      await toast('Payers saved');
    };
    await openClaim(claims.worked);
    const payers = section(s.page, 'Payers');
    const [first] = await order();
    await payers.getByLabel('Add Payer', { exact: true }).first().fill('Blue Plan');
    await payers.getByRole('button', { name: 'Add', exact: true }).click();
    await save();
    await until(s.page, order, (o) => o.join() === `${first},Blue Plan`, 'Blue Plan added second');
    await openClaim(claims.worked);
    await section(s.page, 'Payers').getByRole('button', { name: 'Move Blue Plan up' }).click();
    await save();
    await until(s.page, order, (o) => o[0] === 'Blue Plan', 'Blue Plan moved first');
    await openClaim(claims.worked);
    await section(s.page, 'Payers').getByRole('button', { name: 'Remove Blue Plan' }).click();
    await save();
    await until(s.page, order, (o) => o.join() === first, 'Blue Plan removed');
  });

  it('files a claim once it is reviewed, posts a payment by hand and lowers the balance', async () => {
    await completeTask(s, claims.worked, 'Review claim', { outcome: 'Approve' });
    const { claim } = await claimStatusIs(s, claims.worked, 'submitted');
    await openClaim(claims.worked);
    const form = s.page.getByRole('form', { name: 'Post payment' });
    await form.getByLabel('Paid (USD)').fill('100.00');
    await form.getByLabel('Adjusted (USD)').fill('50.00');
    await form.getByLabel('Paid On').fill('2026-10-20');
    await form.getByRole('button', { name: 'Add Reason Code' }).click();
    await form.getByLabel('Group', { exact: true }).last().selectOption('CO');
    await form.getByLabel('Code', { exact: true }).last().fill('45');
    await form.getByLabel('Amount (USD)', { exact: true }).last().fill('50.00');
    await form.getByRole('button', { name: 'Post Payment' }).click();
    await toast('Payment posted');
    const balanceOf = async () =>
      (await s.page.request.get(`${s.apiUrl}/api/claims/${claims.worked}`).then((r) => r.json()))
        .claim.balance_cents as number;
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
    await s.page
      .getByRole('row')
      .filter({ hasText: `#${claim.number}` })
      .first()
      .waitFor();
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
