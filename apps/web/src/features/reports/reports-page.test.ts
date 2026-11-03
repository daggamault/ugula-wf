import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { findReport, REPORTS } from './catalog.ts';
import type { ReportsClient } from './client.ts';
import {
  defaultRange,
  fileNameOf,
  optionsOf,
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

const range = { from: '2026-01-01', to: '2026-03-31' };

describe('report options', () => {
  it('defaults to the last twelve months from the first of the month', () => {
    assert.deepEqual(defaultRange(now), { from: '2025-11-01', to: '2026-10-23' });
  });

  it('reads the range, group and page from the URL, falling back for bad values', () => {
    assert.deepEqual(rangeOf(new URLSearchParams('from=2026-01-01&to=2026-03-31'), now), range);
    assert.deepEqual(rangeOf(new URLSearchParams('from=jan'), now), defaultRange(now));
    assert.deepEqual(
      ['3', '0', 'x', null].map((p) => pageParam(new URLSearchParams(p ? `page=${p}` : ''))),
      [3, 1, 1, 1]
    );
    const aging = findReport('aging');
    assert.ok(aging);
    assert.deepEqual(optionsOf(aging, new URLSearchParams('group=class&from=x'), now), {
      range: null,
      group: 'class'
    });
    const monthly = findReport('monthly');
    assert.ok(monthly);
    assert.deepEqual(optionsOf(monthly, new URLSearchParams('group=class'), now), {
      range: defaultRange(now),
      group: null
    });
  });

  it('links options and results with only the options a report uses', () => {
    assert.equal(
      optionsPath({ id: 'monthly' }, { range, group: null }),
      '/reports/monthly?from=2026-01-01&to=2026-03-31'
    );
    assert.equal(
      resultsPath({ id: 'aging' }, { range: null, group: 'class' }),
      '/reports/aging/results?group=class'
    );
    assert.equal(
      periodText({ dates: 'posted' }, { range, group: null }, '2026-10-23'),
      'Posted Jan 1, 2026 to Mar 31, 2026'
    );
    assert.match(periodText({ dates: null }, { range: null, group: null }, '2026-10-23'), /^As of/);
  });

  it('names downloads after the report, its group and its period', () => {
    assert.equal(
      fileNameOf({ id: 'payments' }, { range, group: null }, '2026-10-23'),
      'payments-2026-01-01-to-2026-03-31.csv'
    );
    assert.equal(
      fileNameOf({ id: 'aging' }, { range: null, group: 'class' }, '2026-10-23'),
      'aging-by-class-2026-10-23.csv'
    );
  });
});

describe('ReportsPage', () => {
  it('lists every report with its description and a run button', () => {
    const html = renderToStaticMarkup(createElement(ReportsPage));
    for (const r of REPORTS) {
      assert.ok(html.includes(`href="/reports/${r.id}"`), r.id);
      assert.ok(html.includes(r.title) && html.includes(r.description), r.title);
      assert.ok(html.includes(`aria-label="Run ${r.title}"`), r.id);
    }
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
  });
});

describe('ReportOptionsPage', () => {
  const page = (id: string, search = '') =>
    renderToStaticMarkup(
      createElement(ReportOptionsPage, { reportId: id, query: new URLSearchParams(search), now })
    );

  it('asks for the dates the report uses, defaulting to the last 12 months', () => {
    const html = page('monthly');
    assert.ok(html.includes('value="2025-11-01"') && html.includes('value="2026-10-23"'));
    assert.ok(html.includes('Service From') && html.includes('dates of service'));
    assert.ok(html.includes('>Run Report<') && html.includes('href="/reports"'));
    assert.ok(page('payments').includes('Posted From'));
    assert.ok(page('monthly', 'from=2026-01-01&to=2026-03-31').includes('value="2026-01-01"'));
  });

  it('offers a group choice where the report has one', () => {
    const html = page('aging', 'group=class');
    assert.ok(!html.includes('type="date"') && html.includes('Group By'));
    assert.ok(html.includes('<option value="class" selected="">Financial Class</option>'));
  });

  it('runs reports without options from a single button', () => {
    const html = page('unbilled');
    assert.ok(!html.includes('type="date"') && html.includes('has no options'));
  });

  it('explains unknown reports', () => {
    assert.ok(page('nope').includes('There is no report called “nope”.'));
  });
});

describe('ReportResultsPage', () => {
  it('loads the report and goes back to its options with the same dates', () => {
    const client = { run: () => new Promise(() => undefined) } as unknown as ReportsClient;
    const html = renderToStaticMarkup(
      createElement(ReportResultsPage, {
        live: idleLive,
        client,
        reportId: 'monthly',
        query: new URLSearchParams('from=2026-01-01&to=2026-03-31&page=3'),
        now
      })
    );
    assert.ok(html.includes('href="/reports/monthly?from=2026-01-01&amp;to=2026-03-31"'));
    assert.ok(html.includes('Collections by Month of Service</h1>'));
    assert.ok(html.includes('Dates of service Jan 1, 2026 to Mar 31, 2026'));
  });
});
