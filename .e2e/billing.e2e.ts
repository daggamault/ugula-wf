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

const claimRow = () => page.getByRole('row').filter({ hasText: pcr });

const claimLink = () => claimRow().getByRole('link', { name: /^Open claim #/ });

const claimsWith = (status: string) => go(`/claims?number=${pcr}&status=${status}`);

const waitForClaim = async (status: string) => {
  for (let i = 0; i < 40; i++) {
    await claimsWith(status);
    await claimRow()
      .or(page.getByRole('heading', { name: 'No Matching Claims' }))
      .first()
      .waitFor();
    if (await claimLink().count()) return;
    await page.waitForTimeout(3_000);
  }
  assert.fail(`the claim never reached ${status}`);
};

const heading = (name: string | RegExp) => page.getByRole('heading', { level: 1, name });

describe('a biller takes an encounter from import to an 837P file', { timeout: 600_000 }, () => {
  before(async () => {
    browser = await chromium.launch({ channel: config.E2E_BROWSER_CHANNEL, headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(STEP_MS);
    await go('/claims');
    await page.getByLabel('Email').fill(config.DEV_USER_EMAIL);
    await page.getByLabel('Password').fill(config.DEV_USER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await heading('Claims').waitFor();
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
    await page.getByRole('link', { name: `Open import ${pcr}.xml` }).click();
    await heading(`${pcr}.xml`).waitFor();
    await page.getByRole('row').filter({ hasText: pcr }).waitFor();
  });

  it('opens a draft claim while the PCR is worked', async () => {
    await waitForClaim('draft');
    await claimRow().getByText('Draft').waitFor();
  });

  it('works every task from the claim row, including the forced claim review, until the claim is ready', async () => {
    for (let i = 0; i < 60; i++) {
      await go(`/claims?number=${pcr}&status=all`);
      await claimRow().waitFor();
      const work = claimRow().getByRole('link', { name: /^Work / });
      if (!(await work.count())) {
        await claimsWith('ready');
        await claimRow()
          .or(page.getByRole('heading', { name: 'No Matching Claims' }))
          .first()
          .waitFor();
        if (await claimLink().count()) return;
        await page.waitForTimeout(3_000);
        continue;
      }
      await work.click();
      await page.getByText(/· Claim #\d+ · /).waitFor();
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
    assert.fail('the claim never became ready to submit');
  });

  it('submits the claim from its own page and lists its files there', async () => {
    await claimsWith('ready');
    await claimLink().click();
    await heading(/^Claim #\d+$/).waitFor();
    await page.getByText(/^Encounter E2E-\S+$/).waitFor();
    await page.getByRole('button', { name: 'Create 837P file' }).click();
    await page.getByText(/837P file #\d+ is ready/).waitFor();
    const files = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Files' }) });
    await files.getByRole('link', { name: /837P file #\d+/ }).waitFor();
    await files.getByRole('link', { name: /NEMSIS XML/ }).waitFor();
    await waitForClaim('submitted');
  });

  it('shows the submission on the claim history tab', async () => {
    await claimLink().click();
    await page.getByRole('link', { name: /History/ }).click();
    await page.getByRole('link', { name: /837P file #\d+/i }).waitFor();
    await page.getByRole('link', { name: 'Claim data' }).click();
    await page.getByLabel('Date of service').waitFor();
  });

  it('finds the patient by last name and birth date', async () => {
    await go('/patients');
    await page.getByLabel('Last name').fill('kli');
    await page.getByLabel('Birth date').fill('1941-05-22');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: 'Open patient Kline, Dorothy' }).click();
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

  it('searches fees and payers and edits them on their own pages', async () => {
    await go('/fees?q=a04');
    await page.locator('mark', { hasText: /a04/i }).first().waitFor();
    await page.getByRole('link', { name: 'Add Fee' }).first().click();
    await page.getByLabel('HCPCS').waitFor();
    await page.getByRole('link', { name: 'Cancel' }).click();
    await page.waitForURL(/\/fees\?q=a04$/);
    await go('/payers');
    await page.getByRole('link', { name: 'Add Payer' }).first().click();
    await page.getByLabel('Clearinghouse Payer ID').waitFor();
    await page.getByRole('link', { name: 'Cancel' }).click();
    await page.waitForURL(/\/payers$/);
  });
});
