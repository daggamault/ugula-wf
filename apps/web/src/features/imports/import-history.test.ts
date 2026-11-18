import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { ImportSummary } from './client.ts';
import {
  IMPORT_TABLE,
  ImportHistory,
  importStatus,
  reportOutcomes,
  sourceOf
} from './import-history.tsx';

const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  id: 'i1',
  file_name: 'october.xml',
  source: 'upload',
  report_count: 3,
  created_at: '2026-10-20T14:00:00Z',
  run_id: 'r1',
  run_status: 'suspended',
  uploaded_by_email: 'biller@example.com',
  created: 2,
  revised: 1,
  unchanged: 0,
  claims: 1,
  charges_cents: 114_220,
  ...over
});

const none = { created: 0, revised: 0, unchanged: 0 };

/** The visible value of each cell, without the label shown on narrow screens. */
const valuesOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.lastElementChild?.textContent);

const rowsOf = () =>
  within(screen.getByRole('table', { name: 'Imports' }))
    .getAllByRole('row')
    .slice(1);

describe('reportOutcomes', () => {
  it('counts new, revised and unchanged encounters, in a fixed order', () => {
    assert.deepEqual(reportOutcomes({ created: 3, revised: 1, unchanged: 2 }), [
      '3 new',
      '1 revised',
      '2 unchanged'
    ]);
  });

  it('lists nothing before any report is saved', () => {
    assert.deepEqual(reportOutcomes(none), []);
  });
});

describe('importStatus', () => {
  it('follows the run reading the file', () => {
    assert.deepEqual(importStatus({ run_status: 'completed' }), {
      intent: 'success',
      label: 'Completed'
    });
    assert.deepEqual(importStatus({ run_status: 'faulted' }), {
      intent: 'danger',
      label: 'Stuck'
    });
  });

  it('waits until a run reads the file', () => {
    assert.deepEqual(importStatus({ run_status: null }), {
      intent: 'info',
      label: 'Waiting to Be Read'
    });
  });
});

describe('sourceOf', () => {
  it('names each way a file can arrive', () => {
    assert.deepEqual(
      (['upload', 'sftp', 'manual'] as const).map((source) => sourceOf({ source })),
      ['Upload', 'SFTP', 'Workflow Run']
    );
  });
});

describe('ImportHistory', () => {
  it('shows each file with its source, status, counts, charges and encounters', () => {
    render(
      createElement(ImportHistory, {
        imports: [
          summary(),
          summary({
            id: 'i2',
            file_name: 'november.xml',
            source: 'sftp',
            run_status: 'completed',
            uploaded_by_email: null,
            ...none
          })
        ]
      })
    );
    const [first, second] = rowsOf();
    assert.ok(first && second);
    assert.deepEqual(valuesOf(first), [
      'october.xmlUpload · biller@example.com',
      formatDateTime('2026-10-20T14:00:00Z'),
      'Waiting',
      '3',
      '1',
      '$1,142.20',
      '2 new, 1 revised',
      'Open'
    ]);
    assert.deepEqual(valuesOf(second), [
      'november.xmlSFTP',
      formatDateTime('2026-10-20T14:00:00Z'),
      'Completed',
      '3',
      '1',
      '$1,142.20',
      'None yet',
      'Open'
    ]);
  });

  it('labels the columns and hides the actions heading', () => {
    render(createElement(ImportHistory, { imports: [] }));
    assert.deepEqual(
      screen.getAllByRole('columnheader').map((h) => h.textContent),
      ['File', 'Received', 'Status', 'PCRs', 'Claims', 'Charges', 'Encounters', 'Actions']
    );
    assert.equal(screen.getByText('Actions').className, 'sr-only');
  });

  it('opens each import from its row', () => {
    render(createElement(ImportHistory, { imports: [summary()] }));
    assert.deepEqual(
      screen
        .getAllByRole('link')
        .map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')]),
      [['Open import october.xml', '/imports/i1']]
    );
  });

  it('marks unread report counts and names workflow-run sources', () => {
    render(
      createElement(ImportHistory, {
        imports: [summary({ source: 'manual', report_count: null, uploaded_by_email: null })]
      })
    );
    const [row] = rowsOf();
    assert.ok(row);
    assert.deepEqual(valuesOf(row).slice(0, 4), [
      'october.xmlWorkflow Run',
      formatDateTime('2026-10-20T14:00:00Z'),
      'Waiting',
      '—'
    ]);
  });

  it('highlights the search in file names and uploaders and links back to the search', () => {
    const search = searchStateOf('/imports', new URLSearchParams('q=oct'), IMPORT_TABLE);
    render(
      createElement(ImportHistory, {
        imports: [summary({ uploaded_by_email: 'octavia@example.com' })],
        search
      })
    );
    assert.deepEqual(
      Array.from(document.querySelectorAll('mark'), (m) => m.textContent),
      ['oct', 'oct']
    );
    assert.equal(
      screen.getByRole('link', { name: 'Open import october.xml' }).getAttribute('href'),
      '/imports/i1?back=%2Fimports%3Fq%3Doct'
    );
  });

  it('sorts by its columns and marks the current sort', () => {
    const search = searchStateOf('/imports', new URLSearchParams(), IMPORT_TABLE);
    render(createElement(ImportHistory, { imports: [], search }));
    const received = screen.getByRole('columnheader', { name: 'Received' });
    assert.equal(received.getAttribute('aria-sort'), 'descending');
    assert.equal(
      within(received).getByRole('link').getAttribute('href'),
      '/imports?sort=received&dir=asc'
    );
    assert.equal(
      within(screen.getByRole('columnheader', { name: 'File' }))
        .getByRole('link')
        .getAttribute('href'),
      '/imports?sort=file&dir=asc'
    );
    assert.equal(
      within(screen.getByRole('columnheader', { name: 'Actions' })).queryByRole('link'),
      null
    );
  });
});
