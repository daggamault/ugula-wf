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
    assert.deepEqual(reportOutcomes(summary()), ['1 in review', '1 failed']);
    assert.deepEqual(reportOutcomes(summary({ waiting: 0, failed: 0 })), []);
  });
});

describe('importStatus', () => {
  it('stays in progress after the split while its reports still need work', () => {
    const done = summary({ run_status: 'completed', waiting: 0, failed: 0 });
    assert.equal(importStatus(done).label, 'Done');
    assert.equal(importStatus({ ...done, waiting: 2 }).label, 'Reports in progress');
    assert.equal(importStatus({ ...done, stuck: 1 }).label, 'Reports in progress');
    assert.equal(importStatus({ ...done, failed: 1 }).label, 'Done');
    assert.equal(importStatus(summary()).label, 'In review');
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
    assert.ok(html.includes('href="/runs/r1"'));
    assert.ok(html.includes('Upload · biller@example.com'));
    assert.ok(html.includes('>SFTP<'));
    assert.ok(html.includes('>In review<') && html.includes('>Done<'));
    assert.ok(html.includes('1 in review, 1 failed'));
    assert.ok(html.includes('$1,142.20'));
  });
});
