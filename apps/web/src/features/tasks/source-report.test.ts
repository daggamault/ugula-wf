import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TasksClient } from './client.ts';
import { SourceReportPanel, SourceReportView } from './source-report.tsx';
import { fixtureDictionary, fixtureReport, fixtureXml } from './testing.ts';

const source = {
  report: {
    id: 'rep-1',
    position: 0,
    pcr_number: 'PCR-1',
    import_id: 'i1',
    file_name: 'october.xml',
    created_at: '2026-10-01T00:00:00Z'
  },
  data: {
    ePatient: { 'ePatient.17': '1980-01-02', 'ePatient.25': '9919001' },
    eOther: { 'eOther.22': 'Y' }
  },
  xml: '<PatientCareReport/>',
  dictionary: {
    elements: { 'eOther.22': 'File Attachment Name' },
    codes: { 'ePatient.25': { '9919001': 'Female' } }
  }
};

describe('SourceReportView', () => {
  it('shows where the report came from and its elements with NEMSIS labels and code meanings', () => {
    const html = renderToStaticMarkup(createElement(SourceReportView, { source }));
    assert.ok(html.includes('PCR-1 from october.xml'));
    assert.ok(html.includes('Date of birth'));
    assert.ok(html.includes('File Attachment Name'));
    assert.ok(html.includes('Female'));
    assert.ok(html.includes('Copy XML'));
    assert.ok(!html.includes('aria-pressed'));
  });

  it('leads with a readable summary of a fixture report and keeps its XML behind a toggle', () => {
    const html = renderToStaticMarkup(
      createElement(SourceReportView, {
        source: {
          ...source,
          data: fixtureReport('nemsis-34-emergency.xml'),
          xml: fixtureXml('nemsis-34-emergency.xml'),
          dictionary: fixtureDictionary
        }
      })
    );
    const summary = html.indexOf('Wilhelmina Thorncastle');
    const xml = html.indexOf('Show XML</summary>');
    assert.ok(summary > 0 && xml > summary);
    assert.ok(html.includes('Patient Treated, Transported by this EMS Unit'));
    assert.ok(html.includes('6.83 miles'));
    assert.match(html, /<details class="[^"]*border-t[^"]*"><summary/);
  });

  it('names a report without a PCR number by its place in the file', () => {
    const html = renderToStaticMarkup(
      createElement(SourceReportView, {
        source: { ...source, report: { ...source.report, pcr_number: null, position: 2 } }
      })
    );
    assert.ok(html.includes('Report #3 from october.xml'));
  });
});

describe('SourceReportPanel', () => {
  it('shows a spinner while the report loads', () => {
    const html = renderToStaticMarkup(
      createElement(SourceReportPanel, {
        client: { report: async () => source } as unknown as TasksClient,
        reportId: 'rep-1'
      })
    );
    assert.ok(html.includes('aria-label="Loading"') && !html.includes('Source Report'));
  });
});
