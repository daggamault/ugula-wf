import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { claimState, importEncounter, reviewed, uploadPayerFile } from './shared/claims.ts';
import { chooseOption, chosenValue, listboxByLabel } from './shared/listbox.ts';
import {
  api,
  confirmDelete,
  FLOW_MS,
  go,
  heading,
  rowWith,
  type Session,
  SUITE_MS,
  send,
  signIn,
  toast,
  uniqueId,
  until
} from './shared/session.ts';
import { batchAcknowledgment999, remittance835 } from './shared/x12.ts';

let s: Session;

const UNKNOWN_CLAIM = '19990101-9999';
const MUTED_CHECK = 'msp-unanswered';

const run = uniqueId('E2E-ADM');
const feeCode = `Q${String((Number.parseInt(run.replace(/\W/g, ''), 36) % 9000) + 1000)}`;
const payerName = uniqueId('E2E Payer');
const payerCode = uniqueId('E2E').replace(/\W/g, '').slice(0, 20);
const facilityName = uniqueId('E2E Holy Spirit');

type Connection = {
  is_active: boolean;
  secret_set: boolean;
  vendor: string;
  sftp_username: string;
};

const connection = async () =>
  (await api<{ connection: Connection | null }>(s, '/api/clearinghouse-connection')).connection;

const removeLeftovers = async () => {
  const fees = await api<{ items: { id: string; code: string; payer: string | null }[] }>(
    s,
    `/api/fees?q=${feeCode}`
  );
  for (const f of fees.items.filter((x) => x.code === feeCode && x.payer === null)) {
    await send(s, 'DELETE', `/api/fees/${f.id}`);
  }
  const payers = await api<{ items: { id: string; name: string }[] }>(
    s,
    `/api/payers?q=${encodeURIComponent(payerName)}`
  );
  for (const p of payers.items.filter((x) => x.name === payerName)) {
    await send(s, 'DELETE', `/api/payers/${p.id}`);
  }
  const facilities = await api<{ items: { id: string; name: string }[] }>(
    s,
    `/api/facilities?q=${encodeURIComponent(facilityName)}`
  );
  for (const f of facilities.items.filter((x) => x.name.startsWith(facilityName))) {
    await send(s, 'DELETE', `/api/facilities/${f.id}`);
  }
  const tables = await api<{ items: { id: string; key: string; overrides: string | null }[] }>(
    s,
    '/api/tables?show=customized&q=check-severity'
  );
  for (const t of tables.items.filter((x) => x.key === 'billing.check-severity' && x.overrides)) {
    await send(s, 'DELETE', `/api/tables/${t.id}`);
  }
};

describe('an administrator keeps fees, payers, facilities, settings, tables, reports and payer files', {
  timeout: SUITE_MS
}, () => {
  before(async () => {
    s = await signIn();
    await removeLeftovers();
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
    await toast(page, `${name} added`);
    await go(page, `/fees?q=${feeCode}`);
    const row = rowWith(page, feeCode);
    await row.getByText('$123.45').waitFor();
    await row.getByRole('link', { name: `Edit ${name}` }).click();
    await heading(page, name).waitFor();
    assert.equal(await page.getByLabel('HCPCS').inputValue(), feeCode);
    await page.getByLabel('Amount (USD)').fill('150');
    await page.getByRole('button', { name: 'Save Fee' }).click();
    await toast(page, `${name} updated`);
    await page.waitForURL(/\/fees\?q=/);
    await row.getByText('$150.00').waitFor();
    await row.getByRole('button', { name: `Delete ${name}` }).click();
    await confirmDelete(page, name);
    await page.getByRole('heading', { name: 'No Matching Fees' }).waitFor();
    assert.equal(await rowWith(page, feeCode).count(), 0);
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
    await chooseOption(listboxByLabel(page, 'Claim Filing'), 'CI');
    await page.getByLabel('Filing Limit (Days)').fill('90');
    await page.getByRole('button', { name: 'Save Payer' }).click();
    await toast(page, `${payerName} saved`);
    await go(page, `/payers?q=${encodeURIComponent(payerName)}`);
    const row = rowWith(page, payerName);
    await row.getByText(payerCode).waitFor();
    await row.getByText(/^CI · Commercial insurance$/).waitFor();
    await row.getByRole('link', { name: `Edit ${payerName}` }).click();
    await heading(page, payerName).waitFor();
    assert.equal(await page.getByLabel('Clearinghouse Payer ID').inputValue(), payerCode);
    assert.equal(await page.getByLabel('Filing Limit (Days)').inputValue(), '90');
    await page.getByText(/No learned names yet/).waitFor();
    await page.getByLabel('Filing Limit (Days)').fill('180');
    await page.getByRole('button', { name: 'Save Payer' }).click();
    await toast(page, `${payerName} saved`);
    await page.waitForURL(/\/payers\?q=/);
    await row.getByRole('link', { name: `Edit ${payerName}` }).click();
    await heading(page, payerName).waitFor();
    assert.equal(await page.getByLabel('Filing Limit (Days)').inputValue(), '180');
    await page.getByRole('button', { name: 'Delete Payer' }).click();
    await confirmDelete(page, payerName);
    await go(page, `/payers?q=${encodeURIComponent(payerName)}`);
    await page.getByRole('heading', { name: /No Matching Payers/ }).waitFor();
  });

  it('adds a contract facility filled from the CMS hospital list, edits it and deletes it', async () => {
    const page = s.page;
    await go(page, '/facilities');
    await heading(page, 'Facilities').waitFor();
    await page.getByRole('link', { name: 'Add Facility' }).first().click();
    await heading(page, 'Add Facility').waitFor();
    const picker = listboxByLabel(page, 'Fill From CMS Hospital');
    await picker.click();
    await page.getByLabel('Search Fill From CMS Hospital').fill('Holy Spirit');
    const option = page.getByRole('option', { name: /Holy Spirit/i }).first();
    await option.waitFor();
    await option.click();
    await until(
      page,
      () => page.getByLabel('Facility Name').inputValue(),
      (name) => /Holy Spirit/i.test(name),
      'the hospital to fill the form'
    );
    assert.ok(await page.getByLabel('City').inputValue(), 'the city is filled');
    assert.match(await page.getByLabel('ZIP Code').inputValue(), /^\d{5}/);
    assert.equal(await chosenValue(listboxByLabel(page, 'Kind')), 'hospital');
    await page.getByLabel('Facility Name').fill(facilityName);
    await chooseOption(listboxByLabel(page, 'Contract'), 'yes');
    await page.getByLabel('Contract Note').fill('Pays its scheduled transfers');
    await page.getByRole('button', { name: 'Save Facility' }).click();
    await toast(page, `${facilityName} saved`);
    await go(page, `/facilities?q=${encodeURIComponent(facilityName)}`);
    const row = rowWith(page, facilityName);
    await row.getByText(/· contract/).waitFor();
    await row.getByRole('link', { name: `Edit ${facilityName}` }).click();
    await heading(page, facilityName).waitFor();
    assert.equal(
      await page.getByLabel('Contract Note').inputValue(),
      'Pays its scheduled transfers'
    );
    await chooseOption(listboxByLabel(page, 'Contract'), 'no');
    await page.getByRole('button', { name: 'Save Facility' }).click();
    await toast(page, `${facilityName} saved`);
    await go(page, `/facilities?q=${encodeURIComponent(facilityName)}`);
    assert.equal(
      await rowWith(page, facilityName)
        .getByText(/· contract/)
        .count(),
      0
    );
    await rowWith(page, facilityName)
      .getByRole('button', { name: `Delete ${facilityName}` })
      .click();
    await confirmDelete(page, facilityName);
    await page.getByRole('heading', { name: /No Matching Facilities/ }).waitFor();
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
    await toast(page, 'Billing profile saved');
  });

  it('keeps the paused mock clearinghouse connection and its password when saved without one', async () => {
    const page = s.page;
    const before = await connection();
    assert.ok(before?.secret_set, 'the e2e connection has a password');
    assert.equal(before.is_active, false, 'the e2e agency exchanges nothing');
    await go(page, '/settings');
    const form = page.getByRole('form', { name: 'Clearinghouse connection' });
    await form.waitFor();
    assert.equal(await chosenValue(listboxByLabel(form, 'Clearinghouse')), 'mock');
    assert.equal(await chosenValue(listboxByLabel(form, 'Status')), 'off');
    assert.equal(await form.getByLabel('Host Key').inputValue(), MOCK_HOST_KEY);
    await form.getByText('A password is set. Leave blank to keep it, or type a new one.').waitFor();
    const username = form.getByLabel('Username');
    await username.fill(`${before.sftp_username}-changed`);
    await form.getByText('Enter the password again for the changed server or account.').waitFor();
    await username.fill(before.sftp_username);
    await form.getByText('A password is set. Leave blank to keep it, or type a new one.').waitFor();
    assert.equal(await form.getByLabel('Password').inputValue(), '');
    await form.getByRole('button', { name: 'Save Connection' }).click();
    await toast(page, 'Clearinghouse connection saved');
    const after = await connection();
    assert.deepEqual(
      { active: after?.is_active, secret: after?.secret_set, vendor: after?.vendor },
      { active: false, secret: true, vendor: 'mock' }
    );
  });

  it('overrides the check severity table for the agency to turn a check off, then removes it', async () => {
    const page = s.page;
    const claimId = await importEncounter(s, uniqueId('E2E-ADM'));
    const built = await reviewed(s, claimId);
    assert.ok(
      built.issues.some((i) => i.code === MUTED_CHECK && i.severity === 'warning'),
      `a Medicare claim warns ${MUTED_CHECK}`
    );
    await go(page, '/tables?q=Check%20Severity');
    await heading(page, 'Tables').waitFor();
    await rowWith(page, 'billing.check-severity')
      .getByRole('link', { name: 'Edit Check Severity' })
      .click();
    await heading(page, 'Check Severity').waitFor();
    await page.getByRole('button', { name: 'Override for This Agency' }).click();
    await toast(page, 'Check Severity copied for this agency');
    const redraft = page.getByRole('button', { name: 'Edit as New Draft' });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await redraft.or(save).first().waitFor();
    const keys = page.getByRole('textbox', { name: 'Key', exact: true });
    const values = page.getByRole('textbox', { name: 'Value', exact: true });
    const index = (
      await keys.evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value))
    ).indexOf(MUTED_CHECK);
    assert.ok(index >= 0, `${MUTED_CHECK} is listed`);
    if ((await values.nth(index).inputValue()) !== 'off') {
      if (await redraft.isVisible()) {
        await redraft.click();
        await toast(page, /^Draft v\d+ saved$/);
      }
      await values.nth(index).fill('off');
      await page.getByText('Unsaved', { exact: true }).waitFor();
      await save.click();
      await toast(page, /^Draft v\d+ saved$/);
    }
    const publish = page.getByRole('button', { name: 'Publish' });
    if ((await publish.count()) && (await publish.getAttribute('aria-disabled')) !== 'true') {
      await publish.click();
      await toast(page, /^Check Severity v\d+ published$/);
    }
    await until(
      page,
      () => claimState(s, claimId),
      (c) => !c.issues.some((i) => i.code === MUTED_CHECK),
      `${MUTED_CHECK} to be off`
    );
    await go(page, '/tables?show=customized');
    const copy = rowWith(page, 'billing.check-severity').filter({ hasText: 'Agency' });
    await rowWith(page, 'billing.check-severity').getByText('Has Your Copy').waitFor();
    await copy.getByRole('link', { name: 'Edit Check Severity' }).click();
    await page.getByRole('button', { name: 'Remove Override' }).click();
    await page
      .getByRole('dialog', { name: 'Remove Override?' })
      .getByRole('button', { name: 'Remove Override' })
      .click();
    await toast(page, 'Override removed');
    await until(
      page,
      () => claimState(s, claimId),
      (c) => c.issues.some((i) => i.code === MUTED_CHECK && i.severity === 'warning'),
      `${MUTED_CHECK} to warn again`
    );
  });

  it('runs every report, showing results or that there is nothing to report, and exports CSV', async () => {
    const page = s.page;
    await go(page, '/reports');
    await heading(page, 'Reports').waitFor();
    await page
      .getByRole('link', { name: /^Open / })
      .first()
      .waitFor();
    const titles = await page
      .getByRole('link', { name: /^Open / })
      .evaluateAll((links) => links.map((l) => l.getAttribute('aria-label') ?? ''));
    assert.ok(titles.length >= 10, 'every report is listed');
    for (const label of titles) {
      const title = label.replace(/^Open /, '');
      await go(page, '/reports');
      await page.getByRole('link', { name: label, exact: true }).click();
      await heading(page, title).waitFor();
      await page.getByRole('button', { name: 'Run Report' }).click();
      await page.waitForURL(/\/results/);
      const results = page.getByRole('table').first();
      const empty = page.getByText('Nothing to report for these options.');
      await results.or(empty).first().waitFor();
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
    const era = remittance835({
      claimNumber: UNKNOWN_CLAIM,
      chargeCents: 10_000,
      paidCents: 6_000
    });
    const eraName = `${uniqueId('E2E-UNKNOWN')}.835`;
    assert.match(await uploadPayerFile(page, eraName, era), /received$/);
    await go(page, '/payer-files');
    await rowWith(page, eraName).getByText('1 of 1 needs you').waitFor({ timeout: FLOW_MS });
    await rowWith(page, eraName)
      .getByRole('link', { name: `Open payer file ${eraName}` })
      .click();
    await heading(page, eraName).waitFor();
    const line = rowWith(page, UNKNOWN_CLAIM);
    await line.getByText('No Match').waitFor();
    await line.getByText(`No claim has number ${UNKNOWN_CLAIM}`).waitFor();
    const href = await page.getByRole('link', { name: 'Download File' }).getAttribute('href');
    const stored = await (await page.request.get(new URL(href ?? '', s.apiUrl).href)).text();
    assert.equal(stored, era);

    assert.match(await uploadPayerFile(page, eraName, era), /could not be applied$/);
    await toast(page, /already imported/);

    const notEdi = `${uniqueId('E2E-NOT-EDI')}.txt`;
    assert.match(await uploadPayerFile(page, notEdi, 'not an X12 file'), /could not be applied$/);
    await toast(page, /This is not a remittance \(835\), acknowledgment/);

    const control = 900_000_000 + (Number.parseInt(run.replace(/\W/g, ''), 36) % 99_999_999);
    const ackName = `${uniqueId('E2E-UNKNOWN')}.999`;
    assert.match(
      await uploadPayerFile(page, ackName, batchAcknowledgment999(control, true)),
      /received$/
    );
    await go(page, '/payer-files');
    await rowWith(page, ackName)
      .getByRole('link', { name: `Open payer file ${ackName}` })
      .click({ timeout: FLOW_MS });
    await heading(page, ackName).waitFor();
    await rowWith(page, String(control)).getByText('No Match').waitFor();
  });
});
