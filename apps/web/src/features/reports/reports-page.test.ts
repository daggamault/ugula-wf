import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REPORTS } from './catalog.tsx';
import type { ReportsClient } from './client.ts';
import { defaultRange, ReportPage, ReportsPage, rangeOf, reportPath } from './reports-page.tsx';

const now = new Date('2026-10-23T12:00:00Z');

describe('report options', () => {
  it('defaults to the last twelve months from the first of the month', () => {
    assert.deepEqual(defaultRange(now), { from: '2025-11-01', to: '2026-10-23' });
    assert.deepEqual(defaultRange(new Date('2026-01-05T00:00:00Z')), {
      from: '2025-02-01',
      to: '2026-01-05'
    });
  });

  it('reads the range from the URL and falls back for missing or malformed dates', () => {
    assert.deepEqual(rangeOf(new URLSearchParams('from=2026-01-01&to=2026-03-31'), now), {
      from: '2026-01-01',
      to: '2026-03-31'
    });
    assert.deepEqual(rangeOf(new URLSearchParams('from=jan'), now), defaultRange(now));
  });

  it('builds shareable run links with only the options a report uses', () => {
    const range = { from: '2026-01-01', to: '2026-03-31' };
    assert.equal(
      reportPath({ id: 'monthly', usesPeriod: true }, range),
      '/reports/monthly?from=2026-01-01&to=2026-03-31&run=1'
    );
    assert.equal(reportPath({ id: 'aging', usesPeriod: false }, range), '/reports/aging?run=1');
    assert.equal(
      reportPath(
        { id: 'monthly', usesPeriod: true },
        range,
        new URLSearchParams('sort=paid&page=4')
      ),
      '/reports/monthly?sort=paid&from=2026-01-01&to=2026-03-31&run=1'
    );
  });
});

describe('ReportsPage', () => {
  it('lists every report in a sortable table with the options it takes', () => {
    const html = renderToStaticMarkup(createElement(ReportsPage));
    for (const r of REPORTS) {
      assert.ok(html.includes(`href="/reports/${r.id}"`), r.id);
      assert.ok(html.includes(r.title), r.title);
    }
    assert.ok(html.includes('aria-label="Reports"'));
    assert.ok(html.includes('aria-sort="ascending"'));
    assert.ok(html.includes('None, as of today') && html.includes('Service date range'));
    assert.ok(html.indexOf('Accounts Receivable Aging') < html.indexOf('Payer Performance'));
  });
});

describe('ReportPage', () => {
  const pending = () => new Promise(() => undefined);
  const client = {
    aging: pending,
    monthly: pending,
    hcpcs: pending,
    payers: pending
  } as unknown as ReportsClient;
  const page = (id: string, search: string) =>
    renderToStaticMarkup(
      createElement(ReportPage, { client, reportId: id, query: new URLSearchParams(search), now })
    );

  it('shows the options first and results only once the report is run', () => {
    const options = page('monthly', '');
    assert.ok(options.includes('Charges and Collections by Month</h1>'));
    assert.ok(options.includes('value="2025-11-01"') && options.includes('value="2026-10-23"'));
    assert.ok(options.includes('Run report'));
    assert.ok(!options.includes('Results'));
    const run = page('monthly', 'from=2026-01-01&to=2026-03-31&run=1');
    assert.ok(run.includes('value="2026-01-01"'));
    assert.ok(run.includes('Results'));
  });

  it('runs reports without options straight from their button', () => {
    const html = page('aging', '');
    assert.ok(html.includes('always shows balances as of today'));
    assert.ok(!html.includes('type="date"'));
  });

  it('explains unknown reports', () => {
    assert.ok(page('nope', '').includes('There is no report called “nope”.'));
  });
});
