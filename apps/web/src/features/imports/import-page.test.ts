import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { ImportReport, ImportSummary, ImportsClient } from './client.ts';
import { ImportPage, ReportsTable, reportOutcome } from './import-page.tsx';

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  id: 'r1',
  position: 0,
  number: '20261105-0001',
  pcr_number: 'PCR-1',
  outcome: 'created',
  encounter_number: '20261105-0011',
  encounter_revision: 1,
  claim_id: null,
  claim_status: null,
  total_cents: null,
  first_name: null,
  last_name: null,
  ...over
});

describe('reportOutcome', () => {
  it('says whether each PCR was a new, revised or unchanged encounter, or is still being read', () => {
    assert.deepEqual(reportOutcome(report()), { intent: 'success', label: 'New' });
    assert.deepEqual(reportOutcome(report({ outcome: 'revised' })), {
      intent: 'info',
      label: 'Revised'
    });
    assert.deepEqual(reportOutcome(report({ outcome: 'unchanged' })), { label: 'Unchanged' });
    assert.deepEqual(reportOutcome(report({ outcome: null })), {
      intent: 'info',
      label: 'Reading'
    });
  });
});

describe('ReportsTable', () => {
  it('lists reports with their encounter, outcome and claim, opening the claim', () => {
    const html = renderToStaticMarkup(
      createElement(ReportsTable, {
        reports: [
          report({
            claim_id: 'c1',
            claim_status: 'needs_review',
            total_cents: 95_000,
            last_name: 'Doe',
            first_name: 'Jane'
          }),
          report({ id: 'r2', position: 1, pcr_number: null, outcome: null, encounter_number: null })
        ]
      })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/claims/c1" aria-label="Open claim for PCR-1"'));
    assert.equal(html.split('href="/claims/').length, 2);
    assert.ok(html.includes('>Doe, Jane<') && html.includes('$950.00'));
    assert.ok(html.includes('>Needs Review<') && html.includes('>No claim<'));
    assert.ok(html.includes('>New<') && html.includes('>Reading<'));
    assert.ok(html.includes('>20261105-0011<'));
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
    created: 1,
    revised: 1,
    unchanged: 0,
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
            report({ id: 'r2', position: 1, number: '20261105-0002', outcome: 'revised' })
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
    assert.ok(screen.getByText('Completed'));
    assert.ok(screen.getByText('New Encounters'));
    assert.equal(
      screen.getByRole('link', { name: /Open Run/ }).getAttribute('href'),
      '/runs/run-1'
    );
    const table = await screen.findByRole('table', { name: 'PCRs in this file' });
    const rows = within(table).getAllByRole('row').slice(1);
    assert.deepEqual(
      rows.map((r) => within(r).queryByText(/^(New|Revised)$/)?.textContent),
      ['New', 'Revised']
    );
    assert.ok(within(table).getByRole('link', { name: 'Open claim for PCR-1' }));
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

  it('waits for a run to read the file, without a run to open', async () => {
    const { client } = fakeClient({
      find: async () => ({ ...file, run_id: null, run_status: null }),
      reports: async () => ({ items: [], total: 0, page: 1, pageSize: 25 })
    });
    show(client);
    assert.ok(await screen.findByText('Waiting to Be Read'));
    assert.ok(!screen.queryByRole('link', { name: /Open Run/ }));
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
