import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportSummary } from './client.ts';
import { ImportHistory, importStatus, reportOutcomes } from './import-history.tsx';

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

describe('reportOutcomes', () => {
  it('lists only the outcomes that need someone', () => {
    assert.deepEqual(reportOutcomes(summary()), ['1 waiting', '1 failed']);
    assert.deepEqual(reportOutcomes(summary({ waiting: 0, failed: 0 })), []);
  });
});

describe('importStatus', () => {
  it('stays in progress after the split while its reports still need work', () => {
    const done = summary({ run_status: 'completed', waiting: 0, failed: 0 });
    assert.equal(importStatus(done).label, 'Completed');
    assert.equal(importStatus({ ...done, waiting: 2 }).label, 'PCRs in Progress');
    assert.equal(importStatus({ ...done, stuck: 1 }).label, 'PCRs in Progress');
    assert.equal(importStatus({ ...done, failed: 1 }).label, 'Completed');
    assert.equal(importStatus(summary()).label, 'Waiting');
  });
});

describe('ImportHistory', () => {
  it('shows each file with its source, status, claims and charges', () => {
    const html = renderToStaticMarkup(
      createElement(ImportHistory, {
        imports: [
          summary(),
          summary({
            id: 'i2',
            source: 'sftp',
            run_status: 'completed',
            uploaded_by_email: null,
            waiting: 0,
            failed: 0
          })
        ]
      })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/imports/i1" aria-label="Open import october.xml"'));
    assert.equal(html.split('href="/imports/i1"').length, 2);
    assert.ok(html.includes('Upload · biller@example.com'));
    assert.ok(html.includes('>SFTP<'));
    assert.ok(html.includes('>Waiting<') && html.includes('>Completed<'));
    assert.ok(html.includes('1 waiting, 1 failed'));
    assert.ok(html.includes('$1,142.20'));
  });
});

describe('ImportHistory placeholders', () => {
  it('marks unread counts and files that need nothing, and names workflow-run sources', () => {
    const html = renderToStaticMarkup(
      createElement(ImportHistory, {
        imports: [
          summary({
            source: 'manual',
            report_count: null,
            run_status: 'running',
            uploaded_by_email: null,
            waiting: 0,
            failed: 0,
            processing: 0
          })
        ]
      })
    );
    assert.ok(html.includes('>—<') && html.includes('>Nothing<'));
    assert.ok(html.includes('>Workflow run<'));
    assert.deepEqual(reportOutcomes(summary({ stuck: 2, processing: 1, waiting: 0, failed: 0 })), [
      '2 stuck',
      '1 running'
    ]);
  });
});
