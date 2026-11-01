import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportReport } from './client.ts';
import { patientOf, ReportsTable, reportOutcome } from './import-page.tsx';

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  id: 'r1',
  position: 0,
  pcr_number: 'PCR-1',
  run_status: 'completed',
  claim_id: null,
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
      label: 'Claim opened',
      link: { label: 'Open claim', to: '/claims/c1' }
    });
    assert.equal(
      reportOutcome(report({ task_id: 'k1', task_title: 'Review PCR' })).link?.to,
      '/tasks/k1'
    );
    assert.equal(reportOutcome(report({ task_id: 'k1', task_kind: 'fault' })).label, 'Stuck');
    assert.equal(reportOutcome(report()).label, 'No claim');
    assert.equal(reportOutcome(report({ run_status: 'running' })).label, 'Processing');
    assert.equal(reportOutcome(report({ run_status: 'failed' })).label, 'Failed');
  });

  it('names the patient from the claim or the open task', () => {
    assert.equal(patientOf(report({ last_name: 'Doe', first_name: 'Jane' })), 'Doe, Jane');
    assert.equal(patientOf(report({ task_subject: 'PCR-1 · Jane Doe' })), 'PCR-1 · Jane Doe');
    assert.equal(patientOf(report()), null);
  });
});

describe('ReportsTable', () => {
  it('lists reports in file order with their outcome', () => {
    const html = renderToStaticMarkup(
      createElement(ReportsTable, {
        reports: [
          report({ claim_id: 'c1', total_cents: 95_000, last_name: 'Doe', first_name: 'Jane' }),
          report({ id: 'r2', position: 1, task_id: 'k1', task_title: 'Review PCR' })
        ]
      })
    );
    assert.ok(html.includes('href="/claims/c1"') && html.includes('$950.00'));
    assert.ok(html.includes('href="/tasks/k1"') && html.includes('Waiting on a person'));
  });
});
