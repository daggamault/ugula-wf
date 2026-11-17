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
  completed: 1,
  waiting: 1,
  stuck: 0,
  failed: 1,
  processing: 0,
  claims: 1,
  charges_cents: 114_220,
  ...over
});

const settled = { waiting: 0, failed: 0, stuck: 0, processing: 0 };

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
  it('lists each outcome that needs someone, in a fixed order', () => {
    assert.deepEqual(reportOutcomes(summary({ waiting: 1, failed: 2, stuck: 3, processing: 4 })), [
      '1 waiting',
      '2 failed',
      '3 stuck',
      '4 running'
    ]);
  });

  it('lists nothing once every report is settled', () => {
    assert.deepEqual(reportOutcomes(summary(settled)), []);
  });
});

describe('importStatus', () => {
  const done = summary({ run_status: 'completed', ...settled });

  it('is completed once the split finished and every report is settled', () => {
    assert.deepEqual(importStatus(done), { intent: 'success', label: 'Completed' });
  });

  it('stays in progress after the split while reports wait, run or are stuck', () => {
    const pending = { intent: 'info', label: 'PCRs in Progress' };
    assert.deepEqual(importStatus({ ...done, waiting: 2 }), pending);
    assert.deepEqual(importStatus({ ...done, processing: 1 }), pending);
    assert.deepEqual(importStatus({ ...done, stuck: 1 }), pending);
  });

  it('counts failed reports as settled', () => {
    assert.deepEqual(importStatus({ ...done, failed: 1 }), {
      intent: 'success',
      label: 'Completed'
    });
  });

  it('follows the split run while it has not completed', () => {
    assert.deepEqual(importStatus(summary()), { intent: 'warning', label: 'Waiting' });
    assert.deepEqual(importStatus(summary({ run_status: 'faulted' })), {
      intent: 'danger',
      label: 'Stuck'
    });
  });
});

describe('sourceOf', () => {
  it('names each way a file can arrive', () => {
    assert.deepEqual(
      (['upload', 'sftp', 'manual'] as const).map((source) => sourceOf({ source })),
      ['Upload', 'SFTP', 'Workflow run']
    );
  });
});

describe('ImportHistory', () => {
  it('shows each file with its source, status, counts, charges and what needs attention', () => {
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
            ...settled
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
      '1 waiting, 1 failed',
      'Open'
    ]);
    assert.deepEqual(valuesOf(second), [
      'november.xmlSFTP',
      formatDateTime('2026-10-20T14:00:00Z'),
      'Completed',
      '3',
      '1',
      '$1,142.20',
      'Nothing',
      'Open'
    ]);
  });

  it('labels the columns and hides the actions heading', () => {
    render(createElement(ImportHistory, { imports: [] }));
    assert.deepEqual(
      screen.getAllByRole('columnheader').map((h) => h.textContent),
      ['File', 'Received', 'Status', 'PCRs', 'Claims', 'Charges', 'Needs Attention', 'Actions']
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
      'october.xmlWorkflow run',
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
