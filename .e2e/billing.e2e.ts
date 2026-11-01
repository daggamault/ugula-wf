import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { type Browser, chromium, type Page } from 'playwright-core';
import { parseE2eConfig, withPcr } from './config.ts';

const config = parseE2eConfig(process.env);
const pcr = `E2E-${Date.now()}`;
const fixture = withPcr(
  readFileSync(new URL('./fixtures/new-patient-medicare.xml', import.meta.url), 'utf8'),
  pcr
);
const STEP_MS = 120_000;

let browser: Browser;
let page: Page;

const go = (path: string) => page.goto(new URL(path, config.E2E_WEB_URL).href);

const claimLink = () =>
  page.getByRole('row').filter({ hasText: pcr }).getByRole('link', { name: /Kline/ });

const heading = (name: string | RegExp) => page.getByRole('heading', { level: 1, name });

describe('a biller takes a report from import to an 837P file', { timeout: 600_000 }, () => {
  before(async () => {
    browser = await chromium.launch({ channel: config.E2E_BROWSER_CHANNEL, headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(STEP_MS);
    await go('/tasks');
    await page.getByLabel('Email').fill(config.DEV_USER_EMAIL);
    await page.getByLabel('Password').fill(config.DEV_USER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await heading('Tasks').waitFor();
  });

  after(async () => {
    await browser?.close();
  });

  it('imports a NEMSIS file from the Imports button', async () => {
    await go('/imports');
    await page.locator('#import-files').setInputFiles({
      name: `${pcr}.xml`,
      mimeType: 'text/xml',
      buffer: Buffer.from(fixture)
    });
    await page
      .getByRole('status')
      .filter({ hasText: `${pcr}.xml received` })
      .waitFor();
    await page.getByRole('link', { name: `${pcr}.xml` }).click();
    await heading(`${pcr}.xml`).waitFor();
    await page.getByRole('row').filter({ hasText: pcr }).waitFor();
  });

  it('works every task the report raises until its claim opens', async () => {
    for (let i = 0; i < 60; i++) {
      await go('/tasks');
      await heading('Tasks').waitFor();
      const start = page.getByRole('button', { name: 'Start working' });
      const caughtUp = page.getByRole('heading', { name: "You're All Caught Up" });
      await start.or(caughtUp).first().waitFor();
      if (await caughtUp.isVisible()) {
        await go(`/claims?q=${pcr}&view=all`);
        await page.getByRole('row').or(page.getByText('No claims match')).first().waitFor();
        if (await claimLink().count()) return;
        await page.waitForTimeout(3_000);
        continue;
      }
      await start.click();
      const decision = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Your Decision' }) })
        .last();
      await decision.waitFor();
      for (const select of await decision.locator('select').all()) {
        if (!(await select.inputValue())) {
          const values = await select
            .locator('option')
            .evaluateAll((options) =>
              options.map((o) => o.getAttribute('value') ?? '').filter(Boolean)
            );
          if (values[0]) await select.selectOption(values[0]);
        }
      }
      await decision.locator('form > div').last().getByRole('button').first().click();
      await page.getByRole('heading', { name: 'Done' }).waitFor();
    }
    assert.fail('the claim never opened');
  });

  it('finds the claim by PCR and creates an 837P file from Ready to submit', async () => {
    await go(`/claims?view=ready&q=${pcr}`);
    const row = page.getByRole('row').filter({ hasText: pcr });
    await row.waitFor();
    await row.getByText('Ready').waitFor();
    await page.getByRole('button', { name: /Create 837P file \(\d+\)/ }).click();
    await page.getByText(/837P file #\d+ holds/).waitFor();
    await go(`/claims?view=ready&q=${pcr}`);
    await page.getByRole('heading', { name: 'Nothing to Submit' }).waitFor();
    await go('/claims/files');
    await heading('837P Files').waitFor();
    await page
      .getByRole('link', { name: /Download #\d+/ })
      .first()
      .waitFor();
  });

  it('shows the submission and its file on the claim history tab', async () => {
    await go(`/claims?q=${pcr}&view=all`);
    await claimLink().click();
    await page.getByRole('link', { name: /History/ }).click();
    await page.getByRole('link', { name: /837P file #\d+/ }).waitFor();
    await page.getByRole('link', { name: 'Claim data' }).click();
    await page.getByLabel('Date of service').waitFor();
  });

  it('finds the patient by last name and birth date', async () => {
    await go('/patients');
    await page.getByLabel('Last name').fill('kli');
    await page.getByLabel('Birth date').fill('1941-05-22');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: 'Kline, Dorothy' }).click();
    await page.getByRole('heading', { name: 'Details' }).waitFor();
  });

  it('keeps new tasks in the notification bell', async () => {
    await page
      .getByRole('button', { name: /^Notifications/ })
      .first()
      .click();
    await page
      .getByRole('dialog', { name: 'Notifications' })
      .getByText(/New task:/)
      .first()
      .waitFor();
    await page.keyboard.press('Escape');
  });

  it('adds fees and payers in dialogs', async () => {
    await go('/fees');
    await page.getByRole('button', { name: 'Add fee' }).click();
    await page.getByRole('dialog').getByLabel('HCPCS').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await go('/payers');
    await page.getByRole('button', { name: 'Add payer' }).click();
    await page.getByRole('dialog').getByLabel('Payer name').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});
