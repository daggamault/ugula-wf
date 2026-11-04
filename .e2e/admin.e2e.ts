import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import {
  api,
  go,
  heading,
  type Session,
  SUITE_MS,
  signIn,
  toasts,
  uniqueId,
  uploadPayerFile
} from './shared/session.ts';
import { batchAcknowledgment999, remittance835 } from './shared/x12.ts';

let s: Session;

const UNKNOWN_CLAIM = 999_999_999;

const feeCode = `Q${String(Math.floor(Math.random() * 9000) + 1000)}`;
const payerName = uniqueId('E2E Payer');
const payerCode = `E2E${Date.now()}`;

const confirmDelete = async (page: Page, name: string) => {
  const dialog = page.getByRole('dialog', { name: `Delete ${name}?` });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await toasts(page).getByText(`${name} deleted`).waitFor();
};

const fileRow = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

const removeLeftovers = async () => {
  const headers = { origin: new URL(s.page.url()).origin };
  const fees = await api<{ items: { id: string; code: string; payer: string | null }[] }>(
    s,
    `/api/fees?q=${feeCode}`
  );
  for (const f of fees.items.filter((x) => x.code === feeCode && x.payer === null)) {
    await s.page.request.delete(`${s.apiUrl}/api/agencies/${s.agencyId}/fees/${f.id}`, { headers });
  }
  const payers = await api<{ items: { id: string; name: string }[] }>(
    s,
    `/api/payers?q=${encodeURIComponent(payerName)}`
  );
  for (const p of payers.items.filter((x) => x.name === payerName)) {
    await s.page.request.delete(`${s.apiUrl}/api/agencies/${s.agencyId}/payers/${p.id}`, {
      headers
    });
  }
};

describe('an administrator keeps fees, payers, settings, reports and payer files', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn();
    const existing = await api<{ items: { code: string }[] }>(s, `/api/fees?q=${feeCode}`);
    assert.ok(!existing.items.some((f) => f.code === feeCode), `${feeCode} is not already priced`);
  });

  after(async () => {
    if (s) await removeLeftovers();
    await s?.browser.close();
  });

  it('adds, finds, reprices and deletes a default fee', async () => {
    const page = s.page;
    const name = `Default ${feeCode}`;
    await go(page, '/fees');
    await heading(page, 'Fees').waitFor();
    await page.getByRole('link', { name: 'Add Fee' }).first().click();
    await heading(page, 'Add Fee').waitFor();
    await page.getByLabel('HCPCS').fill(feeCode);
    await page.getByLabel('Amount (USD)').fill('123.45');
    await page.getByRole('button', { name: 'Save Fee' }).click();
    await toasts(page).getByText(`${name} added`).waitFor();
    await go(page, `/fees?q=${feeCode}`);
    await page.locator('mark', { hasText: feeCode }).first().waitFor();
    const row = page.getByRole('row').filter({ hasText: feeCode });
    await row.getByText('$123.45').waitFor();
    await row.getByRole('link', { name: `Edit ${name}` }).click();
    await heading(page, name).waitFor();
    assert.equal(await page.getByLabel('HCPCS').inputValue(), feeCode);
    await page.getByLabel('Amount (USD)').fill('150');
    await page.getByRole('button', { name: 'Save Fee' }).click();
    await toasts(page).getByText(`${name} updated`).waitFor();
    await page.waitForURL(/\/fees\?q=/);
    await row.getByText('$150.00').waitFor();
    await row.getByRole('button', { name: `Delete ${name}` }).click();
    await confirmDelete(page, name);
    await page.getByRole('heading', { name: 'No Matching Fees' }).waitFor();
    assert.equal(await page.getByRole('row').filter({ hasText: feeCode }).count(), 0);
  });

  it('refuses a negative fee before saving it', async () => {
    const page = s.page;
    await go(page, '/fees/new');
    await page.getByLabel('HCPCS').fill(feeCode);
    const amount = page.getByLabel('Amount (USD)');
    await amount.fill('-1');
    await page.getByRole('button', { name: 'Save Fee' }).click();
    assert.equal(
      await amount.evaluate(
        (el) => (el as unknown as { validity: { rangeUnderflow: boolean } }).validity.rangeUnderflow
      ),
      true
    );
    assert.match(page.url(), /\/fees\/new$/);
    const fees = await api<{ items: { code: string }[] }>(s, `/api/fees?q=${feeCode}`);
    assert.ok(!fees.items.some((f) => f.code === feeCode));
  });

  it('adds a payer with a filing limit, edits it and deletes it', async () => {
    const page = s.page;
    await go(page, '/payers');
    await heading(page, 'Payers').waitFor();
    await page.getByRole('link', { name: 'Add Payer' }).first().click();
    await heading(page, 'Add Payer').waitFor();
    await page.getByLabel('Payer Name').fill(payerName);
    await page.getByLabel('Clearinghouse Payer ID').fill(payerCode);
    await page.getByLabel('Claim Filing').selectOption('CI');
    await page.getByLabel('Filing Limit (Days)').fill('90');
    await page.getByRole('button', { name: 'Save Payer' }).click();
    await toasts(page).getByText(`${payerName} saved`).waitFor();
    await go(page, `/payers?q=${encodeURIComponent(payerName)}`);
    const row = page.getByRole('row').filter({ hasText: payerName });
    await row.getByText(payerCode).waitFor();
    await row.getByText(/^CI · Commercial insurance$/).waitFor();
    await row.getByRole('link', { name: `Edit ${payerName}` }).click();
    await heading(page, payerName).waitFor();
    assert.equal(await page.getByLabel('Clearinghouse Payer ID').inputValue(), payerCode);
    assert.equal(await page.getByLabel('Filing Limit (Days)').inputValue(), '90');
    await page.getByText(/No learned names yet/).waitFor();
    await page.getByLabel('Filing Limit (Days)').fill('180');
    await page.getByRole('button', { name: 'Save Payer' }).click();
    await toasts(page).getByText(`${payerName} saved`).last().waitFor();
    await page.waitForURL(/\/payers\?q=/);
    await row.getByRole('link', { name: `Edit ${payerName}` }).click();
    await heading(page, payerName).waitFor();
    assert.equal(await page.getByLabel('Filing Limit (Days)').inputValue(), '180');
    await page.getByRole('button', { name: 'Delete Payer' }).click();
    await confirmDelete(page, payerName);
    await go(page, `/payers?q=${encodeURIComponent(payerName)}`);
    await page.getByRole('heading', { name: /No Matching Payers/ }).waitFor();
  });

  it('shows the billing profile, refuses an invalid NPI and saves valid values', async () => {
    const page = s.page;
    await go(page, '/settings');
    await heading(page, 'Settings').waitFor();
    const npi = page.getByLabel('NPI');
    const original = await npi.inputValue();
    assert.match(original, /^\d{10}$/);
    assert.ok(await page.getByLabel('Submitter ID').inputValue());
    assert.ok(await page.getByLabel('Receiver ID').inputValue());
    await npi.fill('1234567890');
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await page.getByRole('alert').filter({ hasText: /NPI/i }).first().waitFor();
    await go(page, '/settings');
    assert.equal(await page.getByLabel('NPI').inputValue(), original);
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await toasts(page).getByText('Billing profile saved').waitFor();
  });

  it('runs every report, showing results or that there is nothing to report, and exports CSV', async () => {
    const page = s.page;
    await go(page, '/reports');
    await heading(page, 'Reports').waitFor();
    await page.getByRole('link', { name: /^Run / }).first().waitFor();
    const titles = await page
      .getByRole('link', { name: /^Run / })
      .evaluateAll((links) => links.map((l) => l.getAttribute('aria-label') ?? ''));
    assert.ok(titles.length >= 10, 'every report is listed');
    for (const label of titles) {
      const title = label.replace(/^Run /, '');
      await go(page, '/reports');
      await page.getByRole('link', { name: label, exact: true }).click();
      await heading(page, title).waitFor();
      await page.getByRole('button', { name: 'Run Report' }).click();
      await page.waitForURL(/\/results/);
      const table = page.locator('table').first();
      const empty = page.getByText('Nothing to report for these options.');
      await table.or(empty).first().waitFor();
      if (await empty.isVisible()) continue;
      await page.getByRole('button', { name: 'Print' }).waitFor();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV' }).click();
      const csv = readFileSync((await (await download).path()) ?? '', 'utf8');
      const [header = ''] = csv.split(/\r?\n/);
      assert.ok(header.length > 0, `${title} CSV has a header row`);
    }
  });

  it('applies payer files, flags what matches nothing and never applies a file twice', async () => {
    const page = s.page;
    const era = remittance835(UNKNOWN_CLAIM, 10_000, 6_000);
    const eraName = `${uniqueId('E2E-UNKNOWN')}.835`;
    assert.match(await uploadPayerFile(page, eraName, era), /received$/);
    await go(page, '/payer-files');
    await fileRow(page, eraName).getByText('1 of 1 needs you').waitFor();
    await fileRow(page, eraName)
      .getByRole('link', { name: `Open payer file ${eraName}` })
      .click();
    await heading(page, eraName).waitFor();
    const line = page.getByRole('row').filter({ hasText: String(UNKNOWN_CLAIM) });
    await line.getByText('No Match').waitFor();
    await line.getByText(`No claim has number ${UNKNOWN_CLAIM}`).waitFor();
    const href = await page.getByRole('link', { name: 'Download File' }).getAttribute('href');
    const stored = await (await page.request.get(new URL(href ?? '', s.apiUrl).href)).text();
    assert.equal(stored, era);

    assert.match(await uploadPayerFile(page, eraName, era), /could not be applied$/);
    await toasts(page)
      .getByText(/already imported/)
      .first()
      .waitFor();

    const notEdi = `${uniqueId('E2E-NOT-EDI')}.txt`;
    assert.match(await uploadPayerFile(page, notEdi, 'not an X12 file'), /could not be applied$/);
    await toasts(page)
      .getByText(
        /This is not a remittance \(835\), acknowledgment \(999 or 277CA\) or eligibility \(271\) file/
      )
      .first()
      .waitFor();

    const ackName = `${uniqueId('E2E-UNKNOWN')}.999`;
    assert.match(
      await uploadPayerFile(page, ackName, batchAcknowledgment999(987_654_321, true)),
      /received$/
    );
    await go(page, '/payer-files');
    await fileRow(page, ackName)
      .getByRole('link', { name: `Open payer file ${ackName}` })
      .click();
    await heading(page, ackName).waitFor();
    await page.getByRole('row').filter({ hasText: '987654321' }).getByText('No Match').waitFor();
  });
});
