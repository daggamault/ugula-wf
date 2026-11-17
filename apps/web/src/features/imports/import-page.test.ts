import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { ImportReport, ImportSummary, ImportsClient } from './client.ts';
import { ImportPage, patientOf, ReportsTable, reportOutcome } from './import-page.tsx';

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  id: 'r1',
  position: 0,
  number: '20261105-0001',
  pcr_number: 'PCR-1',
  run_status: 'completed',
  claim_id: null,
  claim_status: null,
  total_cents: null,
  first_name: null,
  last_name: null,
  task_id: null,
  task_title: null,
  task_subject: null,
  task_kind: null,
  ...over
});

describe('reportOutcome', () => {
  it('says what each report became and links to it', () => {
    assert.deepEqual(reportOutcome(report({ claim_id: 'c1' })), {
      intent: 'success',
      label: 'Claim Opened',
      link: { kind: 'claim', name: 'claim for PCR-1', to: '/claims/c1' }
    });
    assert.deepEqual(reportOutcome(report({ task_id: 'k1', task_title: 'Review PCR' })).link, {
      kind: 'task',
      name: 'task Review PCR',
      to: '/tasks/k1'
    });
    assert.equal(
      reportOutcome(report({ task_id: 'k1', task_subject: 'PCR-1 · Jane Doe' })).link?.name,
      'task PCR-1 · Jane Doe'
    );
    assert.equal(
      reportOutcome(report({ claim_id: 'c1', pcr_number: null, position: 2 })).link?.name,
      'claim for PCR #3'
    );
    assert.equal(reportOutcome(report({ task_id: 'k1', task_kind: 'fault' })).label, 'Stuck');
    assert.deepEqual(reportOutcome(report({ task_id: 'k1', claim_id: 'c1' })).link, {
      kind: 'claim',
      name: 'claim for PCR-1',
      to: '/claims/c1'
    });
    assert.equal(reportOutcome(report({ claim_id: 'c1', claim_status: 'void' })).label, 'Void');
    assert.equal(reportOutcome(report()).label, 'No Claim');
    assert.equal(reportOutcome(report({ run_status: 'running' })).label, 'Running');
    assert.equal(reportOutcome(report({ run_status: 'failed' })).label, 'Failed');
    assert.equal(reportOutcome(report({ run_status: 'cancelled' })).label, 'Failed');
    assert.equal(reportOutcome(report({ run_status: 'faulted' })).intent, 'danger');
  });

  it('names the patient from the claim or the open task', () => {
    assert.equal(patientOf(report({ last_name: 'Doe', first_name: 'Jane' })), 'Doe, Jane');
    assert.equal(patientOf(report({ task_subject: 'PCR-1 · Jane Doe' })), 'PCR-1 · Jane Doe');
    assert.equal(patientOf(report({ last_name: 'Doe' })), 'Doe');
    assert.equal(patientOf(report()), null);
  });
});

describe('ReportsTable', () => {
  it('lists reports in file order with their outcome and an open action', () => {
    const html = renderToStaticMarkup(
      createElement(ReportsTable, {
        reports: [
          report({ claim_id: 'c1', total_cents: 95_000, last_name: 'Doe', first_name: 'Jane' }),
          report({
            id: 'r2',
            position: 1,
            number: '20261105-0002',
            task_id: 'k1',
            task_title: 'Review PCR'
          })
        ]
      })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/claims/c1" aria-label="Open claim for PCR-1"'));
    assert.ok(html.includes('href="/tasks/k1" aria-label="Work task Review PCR"'));
    assert.ok(html.includes('>Doe, Jane<') && html.includes('tabular-nums'));
    assert.ok(html.includes('$950.00') && html.includes('>Waiting<'));
    assert.ok(html.includes('>Encounter<') && !html.includes('>#<'));
    assert.ok(html.includes('>20261105-0001<') && html.includes('>20261105-0002<'));
  });
});

describe('ImportPage', () => {
  const file: ImportSummary = {
    id: 'i1',
    file_name: 'october.xml',
    source: 'sftp',
    report_count: 2,
    created_at: '2026-10-20T14:00:00Z',
    run_id: 'run-1',
    run_status: 'completed',
    uploaded_by_email: null,
    completed: 1,
    waiting: 1,
    stuck: 0,
    failed: 0,
    processing: 0,
    claims: 1,
    charges_cents: 95_000
  };

  const fakeClient = (over: Partial<ImportsClient> = {}) => {
    const queries: string[] = [];
    const client = {
      find: async () => file,
      reports: async (_id: string, query: string) => {
        queries.push(query);
        return {
          items: [
            report({ claim_id: 'c1', total_cents: 95_000, last_name: 'Doe', first_name: 'Jane' }),
            report({ id: 'r2', position: 1, number: '20261105-0002', task_id: 'k1' })
          ],
          total: 2,
          page: 1,
          pageSize: 25
        };
      },
      ...over
    } as ImportsClient;
    return { client, queries };
  };

  const show = (client: ImportsClient) =>
    render(createElement(ImportPage, { client, live: idleLive, importId: 'i1' }));

  it('summarises the file and lists what became of each PCR', async () => {
    const { client } = fakeClient();
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'october.xml' }));
    assert.ok(screen.getByText('PCRs in Progress'));
    assert.equal(
      screen.getByRole('link', { name: /Open Run/ }).getAttribute('href'),
      '/runs/run-1'
    );
    const table = await screen.findByRole('table', { name: 'PCRs in this file' });
    const rows = within(table).getAllByRole('row').slice(1);
    assert.deepEqual(
      rows.map((r) => within(r).queryByText(/^(Claim Opened|Waiting)$/)?.textContent),
      ['Claim Opened', 'Waiting']
    );
    assert.ok(within(table).getByRole('link', { name: 'Open claim for PCR-1' }));
    assert.ok(within(table).getByRole('link', { name: 'Work task PCR-1' }));
    assert.ok(!screen.queryByRole('alert'));
  });

  it('sorts the PCRs through the address bar', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const table = await screen.findByRole('table', { name: 'PCRs in this file' });
    await userEvent.setup().click(within(table).getByRole('link', { name: /Charges/ }));
    assert.match(window.location.search, /pcrSort=total/);
    await waitFor(() => assert.match(queries.at(-1) ?? '', /&sort=total&dir=desc$/));
  });

  it('points at the run when the file could not be read', async () => {
    const { client } = fakeClient({
      find: async () => ({ ...file, run_status: 'failed' }),
      reports: async () => ({ items: [], total: 0, page: 1, pageSize: 25 })
    });
    show(client);
    assert.equal(
      (await screen.findByRole('alert')).textContent,
      'The file could not be read. Open its run to see why.'
    );
    assert.ok(await screen.findByText('No PCRs have been read from this file yet.'));
  });

  it('says why the PCRs could not load under the summary', async () => {
    const { client } = fakeClient({ reports: () => Promise.reject(new Error('Timed out')) });
    show(client);
    assert.equal((await screen.findByRole('alert')).textContent, 'Timed out');
    assert.ok(screen.getByRole('heading', { name: 'october.xml' }));
  });

  it('says why the import could not load', async () => {
    const { client } = fakeClient({ find: () => Promise.reject(new Error('Import not found')) });
    show(client);
    assert.ok(await screen.findByText('Import not found'));
    assert.ok(!screen.queryByRole('heading', { name: 'october.xml' }));
  });
});
