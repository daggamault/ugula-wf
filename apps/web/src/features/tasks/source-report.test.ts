import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TasksClient } from './client.ts';
import { SourceReportPanel, SourceReportView } from './source-report.tsx';

const source = {
  report: {
    id: 'rep-1',
    position: 0,
    pcr_number: 'PCR-1',
    import_id: 'i1',
    file_name: 'october.xml',
    created_at: '2026-10-01T00:00:00Z'
  },
  data: { ePatient: { 'ePatient.17': '1980-01-02' } },
  xml: '<PatientCareReport/>'
};

describe('SourceReportView', () => {
  it('shows where the report came from and its elements with NEMSIS labels', () => {
    const html = renderToStaticMarkup(createElement(SourceReportView, { source }));
    assert.ok(html.includes('Patient care report PCR-1 from october.xml'));
    assert.ok(html.includes('Date of birth'));
    assert.ok(html.includes('aria-pressed="true"') && html.includes('>XML<'));
  });
});

describe('SourceReportPanel', () => {
  it('loads the report before showing it', () => {
    const html = renderToStaticMarkup(
      createElement(SourceReportPanel, {
        client: { report: async () => source } as unknown as TasksClient,
        reportId: 'rep-1'
      })
    );
    assert.ok(html.length > 0);
  });
});
