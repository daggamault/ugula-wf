import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright-core';
import { importEncounter } from './shared/claims.ts';
import { chooseOption, listboxByLabel } from './shared/listbox.ts';
import {
  api,
  FLOW_MS,
  go,
  heading,
  type Session,
  SUITE_MS,
  section,
  send,
  signIn,
  toast,
  uniqueId,
  until
} from './shared/session.ts';

type GraphSummary = { id: string; key: string; name: string; overrides: string | null };

const pcr = uniqueId('E2E-WF');
const workflowKey = uniqueId('e2e.flow').toLowerCase();

let s: Session;

const graphs = (show: string, q = '') =>
  api<{ items: GraphSummary[] }>(s, `/api/graphs?show=${show}&q=${encodeURIComponent(q)}`);

const removeGraphs = async (key: string, copiesOnly: boolean) => {
  const mine = (await graphs('mine', key)).items.filter(
    (g) => g.key === key && (!copiesOnly || g.overrides)
  );
  for (const g of mine) await send(s, 'DELETE', `/api/graphs/${g.id}`);
};

const removeDevOverride = () => removeGraphs('dev.process-item', true);

const canvas = (page: Page) => page.getByRole('application').first();

const node = (page: Page, title: string) =>
  canvas(page).getByRole('article', { name: title, exact: true });

const isInView = async (page: Page, title: string) => {
  const area = await canvas(page).boundingBox();
  const box = await node(page, title).first().boundingBox();
  return (
    area !== null &&
    box !== null &&
    box.x >= area.x &&
    box.y >= area.y &&
    box.x + box.width <= area.x + area.width &&
    box.y + box.height <= area.y + area.height
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

const table = (label: string) => s.page.getByRole('table', { name: label });

const dataRows = (label: string) =>
  table(label)
    .getByRole('row')
    .filter({ has: s.page.getByRole('cell') });

const startProcessItem = async (charge: number) => {
  const [target] = (await graphs('workflows', 'Process Item')).items.filter(
    (g) => g.key === 'dev.process-item' && !g.overrides
  );
  assert.ok(target, 'the dev workflow is seeded');
  await go(s.page, `/runs/new?graph=${target.id}`);
  await heading(s.page, 'Run Process Item').waitFor();
  const item = s.page.getByRole('group', { name: 'Item', exact: true });
  await item.getByRole('textbox').first().fill('e2e');
  await item.getByRole('button', { name: 'Add Item' }).click();
  await item.getByRole('spinbutton', { name: 'Units' }).fill('2');
  await item.getByRole('spinbutton', { name: 'Charge' }).fill(String(charge));
  await s.page.getByRole('button', { name: 'Start Run' }).click();
  await s.page.waitForURL(/\/runs\/[\w-]+$/);
};

describe('workflows, runs and imports', { timeout: SUITE_MS }, () => {
  before(async () => {
    s = await signIn();
    await removeDevOverride();
  });

  after(async () => {
    if (s) {
      await removeDevOverride();
      await removeGraphs(workflowKey, false);
    }
    await s?.browser.close();
  });

  it('lists workflows and subworkflows, switching between them with the Show filter', async () => {
    await go(s.page, '/workflows');
    await heading(s.page, 'Workflows').waitFor();
    const list = table('Workflows and subworkflows');
    await list.getByText('Encounter to Claim', { exact: true }).waitFor();
    assert.equal(await list.getByText('Work Draft Claim', { exact: true }).count(), 0);
    await chooseOption(listboxByLabel(s.page, 'Show'), 'blocks');
    await s.page.waitForURL(/kind=blocks/);
    await list.getByText('Bill the Claim', { exact: true }).waitFor();
    const rows = dataRows('Workflows and subworkflows');
    assert.ok((await rows.count()) > 0);
    assert.equal(
      await rows.filter({ hasNotText: 'Subworkflow' }).count(),
      0,
      'every row is a subworkflow'
    );
    assert.equal(await list.getByRole('cell', { name: 'Workflow', exact: true }).count(), 0);
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
    await startProcessItem(12.5);
    await s.page.getByText('Completed').first().waitFor();
    await section(s.page, 'Result').getByText('25').first().waitFor();
    await node(s.page, 'Return').first().waitFor();
  });

  it('cancels a run before it finishes', async () => {
    await startProcessItem(600);
    await s.page.getByRole('button', { name: 'Cancel Run' }).click();
    await s.page
      .getByRole('dialog', { name: 'Cancel Run?' })
      .getByRole('button', { name: 'Cancel Run' })
      .click();
    await toast(s.page, 'Run cancelled');
    const runId = new URL(s.page.url()).pathname.split('/').at(-1);
    await until(
      s.page,
      async () => (await api<{ run: { status: string } }>(s, `/api/runs/${runId}`)).run.status,
      (status) => status === 'cancelled',
      'the run to be cancelled'
    );
    await heading(s.page, /Cancelled/).waitFor();
    assert.equal(await s.page.getByRole('button', { name: 'Cancel Run' }).count(), 0);
  });

  it('lists runs, filters them by status and follows an import into its encounter run', async () => {
    const claimId = await importEncounter(s, pcr);
    assert.ok(claimId);
    await go(s.page, '/runs');
    await heading(s.page, 'Runs').waitFor();
    await dataRows('Workflow runs').filter({ hasText: 'Receive NEMSIS File' }).first().waitFor();
    await chooseOption(listboxByLabel(s.page, 'Status'), 'completed');
    await s.page.waitForURL(/status=completed/);
    const rows = dataRows('Workflow runs');
    await rows.first().waitFor();
    assert.equal(
      await rows.filter({ hasNotText: 'Completed' }).count(),
      0,
      'every run listed is completed'
    );
    const imports = await api<{ items: { file_name: string; run_id: string }[] }>(
      s,
      `/api/imports?q=${encodeURIComponent(pcr)}`
    );
    const ingest = imports.items.find((i) => i.file_name === `${pcr}.xml`);
    assert.ok(ingest, 'the import is listed');
    await go(s.page, `/runs/${ingest.run_id}`);
    await s.page.getByRole('heading', { name: 'Child Runs' }).first().waitFor();
    await s.page
      .getByRole('link', { name: 'Open run #1 Encounter to Claim' })
      .first()
      .press('Enter');
    await s.page.getByText('Waiting').first().waitFor({ timeout: FLOW_MS });
    await node(s.page, 'Open Draft Claim').first().waitFor();
    await s.page.getByRole('link', { name: 'Back to Receive NEMSIS File' }).waitFor();
    await s.page.getByText('Waiting on').first().waitFor({ timeout: FLOW_MS });
  });

  it('overrides a built-in workflow, removes a node, compares and publishes the copy, then removes it', async () => {
    await editGraph('Process Item');
    await s.page.getByRole('button', { name: 'Customize', exact: true }).click();
    await toast(s.page, 'Process Item copied for this agency');
    await s.page.getByRole('main').getByText('Agency', { exact: true }).waitFor();
    assert.equal(
      await s.page.getByRole('link', { name: 'Inputs and Outputs' }).count(),
      0,
      'an override keeps the inputs and outputs of the built-in workflow'
    );
    assert.equal(
      await s.page.getByRole('button', { name: 'Customize', exact: true }).count(),
      0,
      'an agency copy cannot be overridden for the agency again'
    );
    const redraft = s.page.getByRole('button', { name: 'Edit as New Draft' });
    const arrange = s.page.getByRole('button', { name: 'Arrange Nodes' });
    await arrange.or(redraft).first().waitFor();
    if (await redraft.isVisible()) {
      await redraft.click();
      await toast(s.page, /^Draft v\d+ saved$/);
    }
    const removed = 'Delay';
    if (await node(s.page, removed).count()) {
      await node(s.page, removed).click();
      await s.page.getByRole('button', { name: 'Delete Node' }).dispatchEvent('click');
      await until(
        s.page,
        () => node(s.page, removed).count(),
        (n) => n === 0,
        'the node to leave the canvas'
      );
    } else {
      await arrange.click();
    }
    await s.page.getByText('Unsaved', { exact: true }).waitFor();
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await toast(s.page, /^Draft v\d+ saved$/);
    await s.page.getByRole('link', { name: 'Show Removed' }).click();
    await s.page.waitForURL(/[?&]removed=shown/);
    await node(s.page, `${removed} (removed)`).waitFor();
    await s.page.getByRole('link', { name: 'Hide Removed' }).click();
    await s.page.getByRole('link', { name: 'Compare', exact: true }).first().click();
    await s.page.waitForURL(/[?&]panel=compare/);
    const compare = s.page.getByRole('complementary', { name: 'Compare With Base' });
    await compare.getByRole('heading', { name: 'Yours' }).waitFor();
    await compare.getByText(new RegExp(removed)).first().waitFor();
    await compare.getByRole('button', { name: 'Close Compare' }).click();
    await s.page.getByRole('button', { name: 'Publish' }).click();
    await toast(s.page, /^Process Item v\d+ published$/);
    assert.equal(
      (await graphs('mine', 'dev.process-item')).items.filter((g) => g.overrides).length,
      1
    );
    await go(s.page, '/workflows/customized');
    await heading(s.page, 'Customization Map').waitFor();
    const map = s.page.getByRole('region', { name: 'Process Item', exact: true });
    await map.getByText('dev.process-item', { exact: true }).first().waitFor();
    await map.getByRole('link', { name: 'Process Item', exact: true }).first().click();
    await heading(s.page, 'Process Item').waitFor();
    await s.page.getByRole('button', { name: 'Remove Override' }).click();
    await s.page.getByRole('dialog').getByRole('button', { name: 'Remove Override' }).click();
    await toast(s.page, 'Override removed');
    await heading(s.page, 'Process Item').waitFor();
    await s.page.getByRole('main').getByText('Built-in', { exact: true }).waitFor();
    await s.page.getByRole('button', { name: 'Customize', exact: true }).waitFor();
    assert.equal(
      (await graphs('mine', 'dev.process-item')).items.filter((g) => g.overrides).length,
      0
    );
    await go(s.page, '/workflows/customized');
    await heading(s.page, 'Customization Map').waitFor();
    assert.equal(
      await s.page.getByRole('region', { name: 'Process Item', exact: true }).count(),
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
    await s.page.getByRole('link', { name: 'Inputs and Outputs' }).click();
    await s.page.waitForURL(/[?&]panel=signature/);
    const panel = s.page.getByRole('complementary', { name: 'Workflow Inputs and Outputs' });
    for (const title of ['Paths', 'Inputs', 'Outputs', 'Variables']) {
      await section(s.page, title).first().waitFor();
    }
    await panel.getByRole('button', { name: 'Add Input' }).click();
    assert.equal(
      await panel.getByRole('textbox', { name: 'Name' }).first().isDisabled(),
      false,
      'a custom workflow defines its own inputs'
    );
    await panel.getByRole('button', { name: 'Close Inputs and Outputs' }).click();
    await until(
      s.page,
      async () => new URL(s.page.url()).searchParams.get('panel'),
      (p) => p === null,
      'the inputs and outputs panel to close'
    );
    await s.page.getByRole('button', { name: 'Add Node' }).click();
    const picker = s.page.getByRole('dialog', { name: 'Add Node' });
    await picker.getByLabel('Search').fill('round');
    await picker
      .getByRole('button', { name: /^Round/ })
      .first()
      .click();
    await toast(s.page, /^Round added$/);
    await node(s.page, 'Round').first().waitFor();
    await s.page.getByRole('button', { name: 'Save', exact: true }).click();
    await toast(s.page, /^Draft v\d+ saved/);
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
    const row = dataRows('PCRs in this file').filter({ hasText: pcr });
    await row
      .getByText(/Waiting|Claim Opened/)
      .first()
      .waitFor();
    await row.getByRole('link', { name: `Open claim for ${pcr}` }).click();
    await heading(s.page, /^Claim \d{8}-\d{4,}$/).waitFor();
    const xml = s.page.getByRole('link', { name: new RegExp(`Encounter ${pcr} \\(NEMSIS XML\\)`) });
    const href = await xml.getAttribute('href');
    const body = await (await s.page.request.get(new URL(href ?? '', s.apiUrl).href)).text();
    assert.ok(body.includes(pcr) && body.includes('PatientCareReport'));
  });

  it('refuses to import a file that is not NEMSIS XML', async () => {
    await go(s.page, '/imports');
    await heading(s.page, 'Imports').waitFor();
    const chooser = s.page.waitForEvent('filechooser');
    await s.page.getByRole('button', { name: 'Import Files', exact: true }).click();
    await (await chooser).setFiles({
      name: `${pcr}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('not a report')
    });
    await toast(s.page, `${pcr}.txt was not imported`);
  });
});
