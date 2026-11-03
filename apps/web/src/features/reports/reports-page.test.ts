import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { REPORTS } from './catalog.ts';
import type { ReportsClient } from './client.ts';
import {
  defaultRange,
  optionsPath,
  pageParam,
  periodText,
  ReportOptionsPage,
  ReportResultsPage,
  ReportsPage,
  rangeOf,
  resultsPath
} from './reports-page.tsx';

const now = new Date('2026-10-23T12:00:00Z');

describe('report options', () => {
  it('defaults to the last twelve months from the first of the month', () => {
    assert.deepEqual(defaultRange(now), { from: '2025-11-01', to: '2026-10-23' });
  });

  it('reads the range and page from the URL, falling back for bad values', () => {
    assert.deepEqual(rangeOf(new URLSearchParams('from=2026-01-01&to=2026-03-31'), now), {
      from: '2026-01-01',
      to: '2026-03-31'
    });
    assert.deepEqual(rangeOf(new URLSearchParams('from=jan'), now), defaultRange(now));
    assert.deepEqual(
      ['3', '0', 'x', null].map((p) => pageParam(new URLSearchParams(p ? `page=${p}` : ''))),
      [3, 1, 1, 1]
    );
  });

  it('links options and results with only the options a report uses', () => {
    const range = { from: '2026-01-01', to: '2026-03-31' };
    const monthly = { id: 'monthly', usesPeriod: true } as const;
    assert.equal(optionsPath(monthly, range), '/reports/monthly?from=2026-01-01&to=2026-03-31');
    assert.equal(
      resultsPath(monthly, range),
      '/reports/monthly/results?from=2026-01-01&to=2026-03-31'
    );
    assert.equal(resultsPath({ id: 'aging', usesPeriod: false }, range), '/reports/aging/results');
    assert.match(periodText({ usesPeriod: false }, range, now), /^Open balances as of/);
  });
});

describe('ReportsPage', () => {
  it('lists every report with its description and a run button', () => {
    const html = renderToStaticMarkup(createElement(ReportsPage));
    for (const r of REPORTS) {
      assert.ok(html.includes(`href="/reports/${r.id}"`), r.id);
      assert.ok(html.includes(r.title) && html.includes(r.description), r.title);
    }
    for (const r of REPORTS) assert.ok(html.includes(`aria-label="Run ${r.title}"`), r.id);
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
  });
});

describe('ReportOptionsPage', () => {
  const page = (id: string, search = '') =>
    renderToStaticMarkup(
      createElement(ReportOptionsPage, { reportId: id, query: new URLSearchParams(search), now })
    );

  it('asks for dates of service, defaulting to the last 12 months, and goes back to Reports', () => {
    const html = page('monthly');
    assert.ok(html.includes('value="2025-11-01"') && html.includes('value="2026-10-23"'));
    assert.ok(html.includes('>Run Report<') && html.includes('href="/reports"'));
    assert.ok(page('monthly', 'from=2026-01-01&to=2026-03-31').includes('value="2026-01-01"'));
  });

  it('runs reports without options from a single button', () => {
    const html = page('aging');
    assert.ok(!html.includes('type="date"') && html.includes('has no options'));
  });

  it('explains unknown reports', () => {
    assert.ok(page('nope').includes('There is no report called “nope”.'));
  });
});

describe('ReportResultsPage', () => {
  it('loads the report and goes back to its options with the same dates', () => {
    const pending = () => new Promise(() => undefined);
    const client = { monthly: pending } as unknown as ReportsClient;
    const html = renderToStaticMarkup(
      createElement(ReportResultsPage, {
        client,
        reportId: 'monthly',
        query: new URLSearchParams('from=2026-01-01&to=2026-03-31'),
        now
      })
    );
    assert.ok(html.includes('href="/reports/monthly?from=2026-01-01&amp;to=2026-03-31"'));
    assert.ok(html.includes('Charges and Collections by Month</h1>'));
  });
});
