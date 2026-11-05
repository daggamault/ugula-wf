import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import {
  api,
  config,
  FLOW_MS,
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

type GraphSummary = { id: string; key: string; name: string; overrides: string | null };

const pcr = uniqueId('E2E-WF');
const workflowKey = `e2e.flow-${Date.now()}`;

let s: Session;

const graphs = (show: string, q = '') =>
  api<{ items: GraphSummary[] }>(s, `/api/graphs?show=${show}&q=${encodeURIComponent(q)}`);

const removeDemoOverride = async () => {
  const mine = (await graphs('mine', 'demo.process-item')).items.filter(
    (g) => g.key === 'demo.process-item' && g.overrides
  );
  for (const g of mine) {
    await s.page.request.delete(`${s.apiUrl}/api/agencies/${s.agencyId}/graphs/${g.id}`, {
      headers: { origin: new URL(config.E2E_WEB_URL).origin }
    });
  }
};

const node = (page: Page, title: string) =>
  page.locator('.react-flow__node').filter({ has: page.getByRole('article', { name: title }) });

const isInView = async (page: Page, title: string) => {
  const canvas = await page.locator('.react-flow').first().boundingBox();
  const box = await node(page, title).first().boundingBox();
  return (
    canvas !== null &&
    box !== null &&
    box.x >= canvas.x &&
    box.y >= canvas.y &&
    box.x + box.width <= canvas.x + canvas.width &&
    box.y + box.height <= canvas.y + canvas.height
  );
};

const editGraph = async (name: string) => {
  await go(s.page, `/workflows?kind=all&q=${encodeURIComponent(name)}`);
  await s.page
    .getByRole('link', { name: `Edit ${name}`, exact: true })
    .first()
    .click();
  await heading(s.page, name).waitFor();
};

const rowsOf = (label: string) => s.page.getByRole('table', { name: label }).getByRole('row');

describe('workflows, runs and imports', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    await removeDemoOverride();
  });

  after(async () => {
    if (s) await removeDemoOverride();
    await s?.browser.close();
  });

  it('lists workflows and subworkflows, switching between them with the Show filter', async () => {
    await go(s.page, '/workflows');
    await heading(s.page, 'Workflows').waitFor();
    const table = () => s.page.getByRole('table', { name: 'Workflows and subworkflows' });
    await table().getByText('Encounter to Claim', { exact: true }).waitFor();
    assert.equal(await table().getByText('Work Draft Claim', { exact: true }).count(), 0);
    await s.page.getByLabel('Show').selectOption('blocks');
    await s.page.waitForURL(/kind=blocks/);
    await table().getByText('Bill the Claim', { exact: true }).waitFor();
    const kinds = await table()
      .getByRole('row')
      .evaluateAll((rows) =>
        rows.slice(1).map((r) => r.querySelector('td:nth-child(3)')?.textContent ?? '')
      );
    assert.ok(
      kinds.length > 0 && kinds.every((k) => k.includes('Subworkflow') && !k.includes('Workflow'))
    );
    await s.page.getByRole('link', { name: 'New Subworkflow' }).waitFor();
  });

  it('opens Encounter to Claim with every main step on screen, and opens its blocks', async () => {
    await editGraph('Encounter to Claim');
    for (const title of ['Open Draft Claim', 'Work the Draft Claim', 'Review Updated PCR']) {
      await node(s.page, title).first().waitFor();
      await until(s.page, () => isInView(s.page, title), Boolean, `${title} to be in view`);
    }
    await node(s.page, 'Work the Draft Claim').first().dblclick();
    await heading(s.page, 'Work Draft Claim').waitFor();
    const path = s.page.getByRole('navigation', { name: 'Workflow path' });
    await path.getByRole('link', { name: 'Encounter to Claim' }).waitFor();
    await node(s.page, 'Bill the Claim').first().waitFor();
    assert.ok(await isInView(s.page, 'Is a Claim Needed?'));
    await s.page.getByRole('link', { name: 'Back to Encounter to Claim' }).click();
    await heading(s.page, 'Encounter to Claim').waitFor();
  });

  it('starts a run with its inputs and watches it complete', async () => {
    const [target] = (await graphs('workflows', 'Process Item')).items.filter(
      (g) => g.key === 'demo.process-item'
    );
    assert.ok(target, 'the demo workflow is seeded');
    await go(s.page, `/runs/new?graph=${target.id}`);
    await heading(s.page, 'Run Process Item').waitFor();
    await s.page
      .getByLabel('item')
      .fill(JSON.stringify({ id: 'e2e', lines: [{ units: 2, charge: 12.5 }] }));
    await s.page.getByRole('button', { name: 'Start Run' }).click();
    await s.page.waitForURL(/\/runs\/[\w-]+$/);
    await s.page.getByText('Completed').first().waitFor();
    await section(s.page, 'Result').getByText('25').first().waitFor();
    await node(s.page, 'Return').first().waitFor();
  });

  it('lists runs, filters them by status and follows an import into its encounter run', async () => {
    const claimId = await importEncounter(s, pcr);
    assert.ok(claimId);
    await go(s.page, '/runs');
    await heading(s.page, 'Runs').waitFor();
    await rowsOf('Workflow runs').filter({ hasText: 'Ingest NEMSIS File' }).first().waitFor();
    await s.page.getByLabel('Status').selectOption('completed');
    await s.page.waitForURL(/status=completed/);
    await rowsOf('Workflow runs').nth(1).waitFor();
    const statuses = await rowsOf('Workflow runs').evaluateAll((rows) =>
      rows.slice(1).map((r) => r.querySelector('td:nth-child(2)')?.textContent ?? '')
    );
    assert.ok(statuses.length > 0 && statuses.every((t) => t.includes('Completed')));
    const imports = await api<{ items: { file_name: string; run_id: string }[] }>(
      s,
      `/api/imports?q=${encodeURIComponent(pcr)}`
    );
    const ingest = imports.items.find((i) => i.file_name === `${pcr}.xml`);
    assert.ok(ingest, 'the import is listed');
    await go(s.page, `/runs/${ingest.run_id}`);
    await s.page.getByRole('heading', { name: 'Child Runs' }).first().waitFor();
    await s.page.getByRole('link', { name: 'Open run #1 Encounter to Claim' }).first().click();
    await s.page.getByText('Waiting').first().waitFor();
    await node(s.page, 'Open Draft Claim').first().waitFor();
    await s.page.getByRole('link', { name: 'Back to Ingest NEMSIS File' }).waitFor();
    await s.page.getByText('Waiting on').first().waitFor({ timeout: FLOW_MS });
  });

  it('overrides a built-in workflow, arranges, saves and publishes the copy, then removes it', async () => {
    await editGraph('Process Item');
    await s.page.getByRole('button', { name: 'Override for This Agency' }).click();
    await toasts(s.page).getByText('Process Item copied for this agency').waitFor();
    await s.page.getByRole('main').getByText('Agency', { exact: true }).waitFor();
    assert.equal(
      await s.page.getByRole('button', { name: 'Override for This Agency' }).count(),
      0,
      'an agency copy cannot be overridden for the agency again'
    );
    const arrange = s.page.getByRole('button', { name: 'Arrange Nodes' });
    const redraft = s.page.getByRole('button', { name: 'Edit as New Draft' });
    await arrange.or(redraft).first().waitFor();
    if (await redraft.isVisible()) {
      await redraft.click();
      await toasts(s.page)
        .getByText(/^Draft v\d+ saved$/)
        .waitFor();
    }
    await arrange.click();
    await s.page.getByText('Unsaved', { exact: true }).waitFor();
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await toasts(s.page)
      .getByText(/^Draft v\d+ saved$/)
      .waitFor();
    await s.page.getByRole('button', { name: 'Publish' }).click();
    await toasts(s.page)
      .getByText(/^Process Item v\d+ published$/)
      .waitFor();
    assert.equal(
      (await graphs('mine', 'demo.process-item')).items.filter((g) => g.overrides).length,
      1
    );
    await s.page.getByRole('button', { name: 'Remove Override' }).click();
    await s.page.getByRole('dialog').getByRole('button', { name: 'Remove Override' }).click();
    await toasts(s.page).getByText('Override removed').waitFor();
    await heading(s.page, 'Process Item').waitFor();
    await s.page.getByRole('main').getByText('Built-in', { exact: true }).waitFor();
    await s.page.getByRole('button', { name: 'Override for This Agency' }).waitFor();
    assert.equal(
      (await graphs('mine', 'demo.process-item')).items.filter((g) => g.overrides).length,
      0
    );
  });

  it('creates a workflow, adds a node from the picker and saves it', async () => {
    await go(s.page, '/workflows/new?kind=workflow');
    await heading(s.page, 'New Workflow').waitFor();
    await s.page.getByLabel('Name').fill(`E2E ${workflowKey}`);
    await s.page.getByLabel('Key').fill(workflowKey);
    await s.page.getByRole('button', { name: 'Create Workflow' }).click();
    await heading(s.page, `E2E ${workflowKey}`).waitFor();
    await s.page.getByRole('button', { name: 'Add Node' }).click();
    const picker = s.page.getByRole('dialog', { name: 'Add Node' });
    await picker.getByLabel('Search').fill('round');
    await picker
      .getByRole('button', { name: /^Round/ })
      .first()
      .click();
    await toasts(s.page)
      .getByText(/^Round added$/)
      .waitFor();
    await node(s.page, 'Round').first().waitFor();
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await toasts(s.page)
      .getByText(/^Draft v\d+ saved/)
      .waitFor();
    const [created] = (await graphs('mine', workflowKey)).items.filter(
      (g) => g.key === workflowKey
    );
    assert.ok(created, 'the new workflow is saved for the agency');
  });

  it('lists the import, shows what its PCR became and downloads the encounter XML', async () => {
    await go(s.page, '/imports');
    await heading(s.page, 'Imports').waitFor();
    await s.page
      .getByRole('link', { name: `Open import ${pcr}.xml` })
      .first()
      .click();
    await heading(s.page, `${pcr}.xml`).waitFor();
    const row = rowsOf('PCRs in this file').filter({ hasText: pcr });
    await row
      .getByText(/Waiting|Claim Opened/)
      .first()
      .waitFor();
    await row.getByRole('link', { name: `Open claim for ${pcr}` }).click();
    await heading(s.page, /^Claim #\d+$/).waitFor();
    const xml = s.page.getByRole('link', { name: new RegExp(`Encounter ${pcr} \\(NEMSIS XML\\)`) });
    const href = await xml.getAttribute('href');
    const body = await (await s.page.request.get(new URL(href ?? '', s.apiUrl).href)).text();
    assert.ok(body.includes(pcr) && body.includes('PatientCareReport'));
  });

  it('refuses to import a file that is not NEMSIS XML', async () => {
    await go(s.page, '/imports');
    await s.page.locator('input[type="file"][accept*="xml"]').setInputFiles({
      name: `${pcr}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('not a report')
    });
    await toasts(s.page).getByText(`${pcr}.txt was not imported`).waitFor();
  });
});
