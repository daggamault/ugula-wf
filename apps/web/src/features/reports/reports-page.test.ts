import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import { findReport, REPORTS } from './catalog.ts';
import type { ReportOptions, ReportsClient } from './client.ts';
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

const texts = (els: HTMLElement[]) => els.map((e) => e.textContent);

describe('defaultRange', () => {
  it('covers the last twelve months from the first of the month', () => {
    assert.deepEqual(defaultRange(now), { from: '2025-11-01', to: '2026-10-23' });
  });

  it('reaches back across the year from January', () => {
    assert.deepEqual(defaultRange(new Date('2026-01-31T00:00:00Z')), {
      from: '2025-02-01',
      to: '2026-01-31'
    });
  });
});

describe('rangeOf', () => {
  it('reads the range from the URL', () => {
    assert.deepEqual(rangeOf(new URLSearchParams('from=2026-01-01&to=2026-03-31'), now), range);
  });

  it('falls back to the default for each missing or malformed end', () => {
    assert.deepEqual(rangeOf(new URLSearchParams('from=jan'), now), defaultRange(now));
    assert.deepEqual(rangeOf(new URLSearchParams('from=2026-01-01&to=2026-3-1'), now), {
      from: '2026-01-01',
      to: '2026-10-23'
    });
  });
});

describe('pageParam', () => {
  it('reads whole pages after the first and falls back to the first', () => {
    assert.deepEqual(
      ['3', '0', '-2', '1.5', 'x', null].map((p) =>
        pageParam(new URLSearchParams(p ? `page=${p}` : ''))
      ),
      [3, 1, 1, 1, 1, 1]
    );
  });
});

describe('optionsOf', () => {
  it('reads a group but no range for reports without dates', () => {
    const aging = findReport('aging');
    assert.ok(aging);
    assert.deepEqual(optionsOf(aging, new URLSearchParams('group=class&from=x'), now), {
      range: null,
      group: 'class'
    });
    assert.deepEqual(optionsOf(aging, new URLSearchParams('group=bogus'), now), {
      range: null,
      group: 'payer'
    });
  });

  it('reads a range but no group for reports without groups', () => {
    const monthly = findReport('monthly');
    assert.ok(monthly);
    assert.deepEqual(optionsOf(monthly, new URLSearchParams('group=class'), now), {
      range: defaultRange(now),
      group: null
    });
  });
});

describe('report paths', () => {
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
      optionsPath({ id: 'unbilled' }, { range: null, group: null }),
      '/reports/unbilled'
    );
  });
});

describe('periodText', () => {
  it('names the dates the report covers', () => {
    assert.equal(
      periodText({ dates: 'posted' }, { range, group: null }, '2026-10-23'),
      'Posted Jan 1, 2026 to Mar 31, 2026'
    );
    assert.equal(
      periodText({ dates: 'service' }, { range, group: null }, '2026-10-23'),
      'Dates of service Jan 1, 2026 to Mar 31, 2026'
    );
  });

  it('says when a report without dates was run', () => {
    assert.equal(
      periodText({ dates: null }, { range: null, group: null }, '2026-10-23'),
      'As of Oct 23, 2026'
    );
  });
});

describe('fileNameOf', () => {
  it('names downloads after the report, its group and its period', () => {
    assert.equal(
      fileNameOf({ id: 'payments' }, { range, group: null }, '2026-10-23'),
      'payments-2026-01-01-to-2026-03-31.csv'
    );
    assert.equal(
      fileNameOf({ id: 'aging' }, { range: null, group: 'class' }, '2026-10-23'),
      'aging-by-class-2026-10-23.csv'
    );
    assert.equal(
      fileNameOf({ id: 'payers' }, { range, group: 'payer' }, '2026-10-23'),
      'payers-by-payer-2026-01-01-to-2026-03-31.csv'
    );
  });
});

describe('ReportsPage', () => {
  it('lists every report with its description', () => {
    render(createElement(ReportsPage));
    const rows = within(screen.getByRole('table', { name: 'Reports' })).getAllByRole('row');
    assert.deepEqual(texts(within(rows[0] as HTMLElement).getAllByRole('columnheader')), [
      'Report',
      'Description',
      'Actions'
    ]);
    assert.deepEqual(
      rows.slice(1).map((r) => texts(within(r).getAllByRole('cell')).slice(0, 2)),
      REPORTS.map((r) => [r.title, `Description${r.description}`])
    );
  });

  it('opens each report from its row', () => {
    render(createElement(ReportsPage));
    for (const r of REPORTS) {
      assert.equal(
        screen.getByRole('link', { name: `Open ${r.title}` }).getAttribute('href'),
        `/reports/${r.id}`
      );
    }
  });
});

describe('ReportOptionsPage', () => {
  const show = (id: string, search = '') =>
    render(
      createElement(ReportOptionsPage, { reportId: id, query: new URLSearchParams(search), now })
    );

  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

  it('titles the page after the report and goes back to the reports', () => {
    show('monthly');
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Collections by Month of Service' }));
    assert.ok(screen.getByText(findReport('monthly')?.description ?? ''));
    assert.equal(
      screen.getByRole('link', { name: 'Back to Reports' }).getAttribute('href'),
      '/reports'
    );
  });

  it('asks for the dates the report uses, defaulting to the last 12 months', () => {
    show('monthly');
    assert.ok(screen.getByText('Choose the dates of service to report on.'));
    assert.equal(field('Service From').value, '2025-11-01');
    assert.equal(field('Service To').value, '2026-10-23');
    assert.equal(field('Service From').max, '2026-10-23');
    assert.equal(field('Service To').min, '2025-11-01');
    assert.ok(!screen.queryByRole('button', { name: 'Group By' }));
  });

  it('names the date fields after the dates the report filters by', () => {
    show('payments');
    assert.ok(screen.getByText('Choose the posting dates to report on.'));
    assert.ok(field('Posted From'));
    assert.ok(field('Posted To'));
  });

  it('starts from the dates in the URL', () => {
    show('monthly', 'from=2026-01-01&to=2026-03-31');
    assert.equal(field('Service From').value, '2026-01-01');
    assert.equal(field('Service To').value, '2026-03-31');
  });

  it('offers a group choice without dates where the report has one', () => {
    const { container } = show('aging', 'group=class');
    assert.ok(screen.getByText('It shows where things stand right now.'));
    assert.ok(!container.querySelector('input[type="date"]'));
    assert.equal(screen.getByRole('button', { name: 'Group By' }).textContent, 'Financial Class');
    assert.deepEqual(texts(screen.getAllByRole('option')), ['Payer', 'Financial Class']);
  });

  it('runs reports without options from a single button', () => {
    const { container } = show('unbilled');
    assert.ok(
      screen.getByText('This report has no options. It shows where things stand right now.')
    );
    assert.ok(!container.querySelector('input'));
    assert.deepEqual(texts(within(screen.getByRole('form')).getAllByRole('button')), [
      'Run Report'
    ]);
  });

  it('runs the report with the default options', async () => {
    show('monthly');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Run Report' }));
    assert.equal(
      `${window.location.pathname}${window.location.search}`,
      '/reports/monthly/results?from=2025-11-01&to=2026-10-23'
    );
  });

  it('runs the report with the chosen dates and group', async () => {
    show('denials');
    const user = userEvent.setup();
    await user.type(field('Posted From'), '2026-02-01', {
      initialSelectionStart: 0,
      initialSelectionEnd: 10
    });
    await user.click(screen.getByRole('button', { name: 'Group By' }));
    await user.click(screen.getByRole('option', { name: 'Reason' }));
    await user.click(screen.getByRole('button', { name: 'Run Report' }));
    assert.equal(
      `${window.location.pathname}${window.location.search}`,
      '/reports/denials/results?from=2026-02-01&to=2026-10-23&group=reason'
    );
  });

  it('will not run a range that ends before it starts and says why', async () => {
    show('monthly', 'from=2026-05-01&to=2026-01-01');
    const run = screen.getByRole('button', { name: 'Run Report' });
    assert.equal(run.getAttribute('aria-disabled'), 'true');
    assert.equal(
      document.getElementById(run.getAttribute('aria-describedby') ?? '')?.textContent,
      'Choose a start date on or before the end date.'
    );
    await userEvent.setup().click(run);
    assert.equal(window.location.pathname, '/');
  });

  it('labels the options form for screen readers', () => {
    show('denials');
    assert.ok(screen.getByRole('form', { name: 'Report options' }));
  });

  it('explains unknown reports', () => {
    show('nope');
    assert.ok(screen.getByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('There is no report called “nope”.'));
  });
});

type Run = [string, ReportOptions, number | 'all'];

type Result = {
  asOf: string;
  range: ReportOptions['range'];
  group: string | null;
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totals: Record<string, number>;
};

const monthRow = {
  month: '2026-01',
  claims: 3,
  charges_cents: 300_000,
  payer_paid_cents: 120_000,
  patient_paid_cents: 15_000,
  adjusted_cents: 30_000,
  written_off_cents: 0,
  collections_cents: 0,
  open_balance_cents: 135_000,
  billed: 2,
  bill_days: 7
};

const { month: _, ...monthTotals } = monthRow;

const resultOf = (patch: Partial<Result> = {}): Result => ({
  asOf: '2026-10-23',
  range,
  group: null,
  items: [monthRow],
  total: 1,
  page: 1,
  pageSize: 100,
  totals: monthTotals,
  ...patch
});

const fakeClient = (reply: (page: number | 'all') => Promise<Result> = async () => resultOf()) => {
  const runs: Run[] = [];
  const client = {
    run: (id: string, options: ReportOptions, page: number | 'all') => {
      runs.push([id, options, page]);
      return reply(page);
    }
  } as unknown as ReportsClient;
  return { client, runs };
};

const showResults = (
  client: ReportsClient,
  reportId = 'monthly',
  search = 'from=2026-01-01&to=2026-03-31'
) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(ReportResultsPage, {
        live: idleLive,
        client,
        reportId,
        query: new URLSearchParams(search),
        now
      })
    )
  );
  return toasts;
};

const reportTable = () => screen.findByRole('table');

describe('ReportResultsPage', () => {
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
    click: HTMLAnchorElement.prototype.click,
    print: window.print
  };
  const downloads: { name: string; text: Promise<string> }[] = [];
  let printed = 0;

  beforeEach(() => {
    downloads.length = 0;
    printed = 0;
    const blobs = new Map<string, Blob>();
    URL.createObjectURL = (b: Blob) => {
      const url = `blob:${blobs.size}`;
      blobs.set(url, b);
      return url;
    };
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      downloads.push({ name: this.download, text: blob ? blob.text() : Promise.resolve('') });
    };
    window.print = () => {
      printed += 1;
    };
  });

  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    HTMLAnchorElement.prototype.click = original.click;
    window.print = original.print;
  });

  it('runs the report for the options and page in the URL', async () => {
    const { client, runs } = fakeClient();
    showResults(client, 'monthly', 'from=2026-01-01&to=2026-03-31&page=3');
    await reportTable();
    assert.deepEqual(runs, [['monthly', { range, group: null }, 3]]);
  });

  it('titles the results with the period and goes back to the same options', async () => {
    const { client } = fakeClient();
    showResults(client);
    await reportTable();
    assert.ok(screen.getByRole('heading', { level: 1, name: 'Collections by Month of Service' }));
    assert.equal(
      screen.getByRole('link', { name: 'Back to Report Options' }).getAttribute('href'),
      '/reports/monthly?from=2026-01-01&to=2026-03-31'
    );
    assert.equal(screen.getAllByText('Dates of service Jan 1, 2026 to Mar 31, 2026').length, 2);
  });

  it('shows the report rows, totals and when it was run', async () => {
    const { client } = fakeClient();
    showResults(client);
    const table = await reportTable();
    const [, body, foot] = within(table).getAllByRole('rowgroup');
    assert.ok(body && foot);
    assert.deepEqual(texts(within(body).getAllByRole('cell')), [
      'January 2026',
      '3',
      '$3,000.00',
      '$1,200.00',
      '$150.00',
      '$300.00',
      '$0.00',
      '$0.00',
      '$1,350.00',
      '50%',
      '3.5'
    ]);
    assert.equal(within(foot).getAllByRole('cell')[0]?.textContent, 'Total');
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Collections by Month of Service' }));
    assert.ok(screen.getByText(`Run ${formatDateTime(now.toISOString())}`));
  });

  it('says how a grouped report is grouped and when it stands as of', async () => {
    const { client, runs } = fakeClient(async () =>
      resultOf({ range: null, group: 'class', asOf: '2026-10-20', items: [], total: 1 })
    );
    showResults(client, 'aging', 'group=class');
    await reportTable();
    assert.deepEqual(runs, [['aging', { range: null, group: 'class' }, 1]]);
    assert.ok(screen.getByText('Grouped by Financial Class'));
    assert.equal(screen.getAllByText('As of Oct 20, 2026').length, 2);
  });

  it('says when there is nothing to report and offers no print or download', async () => {
    const { client } = fakeClient(async () => resultOf({ items: [], total: 0 }));
    showResults(client);
    assert.ok(await screen.findByText('Nothing to report for these options.'));
    assert.ok(!screen.queryByRole('table'));
    assert.ok(!screen.queryByRole('button', { name: 'Print' }));
    assert.ok(!screen.queryByRole('button', { name: 'Download CSV' }));
  });

  it('says why the report could not run', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('Report timed out');
    });
    showResults(client);
    assert.equal((await screen.findByRole('alert')).textContent, 'Report timed out');
    assert.ok(!screen.queryByRole('button', { name: 'Download CSV' }));
  });

  it('pages long reports and says which rows are shown', async () => {
    const { client } = fakeClient(async () => resultOf({ total: 250, page: 2 }));
    showResults(client, 'monthly', 'from=2026-01-01&to=2026-03-31&page=2');
    await reportTable();
    assert.ok(screen.getByText('Rows 101–200 of 250 · page 2 of 3'));
    const nav = screen.getByRole('navigation', { name: 'Collections by Month of Service pages' });
    const href = (name: string) => within(nav).getByRole('link', { name }).getAttribute('href');
    assert.equal(href('First Page'), '/reports/monthly/results?from=2026-01-01&to=2026-03-31');
    assert.equal(
      href('Next Page'),
      '/reports/monthly/results?from=2026-01-01&to=2026-03-31&page=3'
    );
    assert.equal(
      href('Last Page'),
      '/reports/monthly/results?from=2026-01-01&to=2026-03-31&page=3'
    );
  });

  it('shows short reports on one page without paging', async () => {
    const { client } = fakeClient(async () => resultOf({ total: 100 }));
    showResults(client);
    await reportTable();
    assert.ok(!screen.queryByRole('navigation'));
    assert.ok(!screen.queryByText(/^Rows /));
  });

  it('prints the report', async () => {
    const { client } = fakeClient();
    showResults(client);
    await reportTable();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Print' }));
    assert.equal(printed, 1);
  });

  it('downloads every row of the report as a CSV', async () => {
    const { client, runs } = fakeClient(async (page) =>
      page === 'all' ? resultOf({ asOf: '2026-10-24', items: [monthRow, monthRow] }) : resultOf()
    );
    const toasts = showResults(client);
    await reportTable();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download CSV' }));
    const name = 'monthly-2026-01-01-to-2026-03-31.csv';
    await waitFor(() => assert.deepEqual(toasts, [{ title: `${name} downloaded` }]));
    assert.deepEqual(runs.at(-1), ['monthly', { range, group: null }, 'all']);
    assert.deepEqual(
      downloads.map((d) => d.name),
      [name]
    );
    const csv = (await downloads[0]?.text)?.split('\r\n');
    assert.equal(csv?.length, 3);
    assert.equal(csv?.[1], '2026-01,3,3000.00,1200.00,150.00,300.00,0.00,0.00,1350.00,50,3.5');
  });

  it('names downloads of reports without dates by the day they stand as of', async () => {
    const { client } = fakeClient(async (page) =>
      resultOf({ range: null, group: 'payer', asOf: page === 'all' ? '2026-10-24' : '2026-10-23' })
    );
    const toasts = showResults(client, 'aging', '');
    await reportTable();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() =>
      assert.deepEqual(toasts, [{ title: 'aging-by-payer-2026-10-24.csv downloaded' }])
    );
  });

  it('says why the download failed', async () => {
    const { client } = fakeClient(async (page) => {
      if (page === 'all') throw new Error('Too many rows');
      return resultOf();
    });
    const toasts = showResults(client);
    await reportTable();
    const download = screen.getByRole('button', { name: 'Download CSV' });
    await userEvent.setup().click(download);
    await waitFor(() =>
      assert.deepEqual(toasts, [
        { intent: 'danger', title: 'Could not download the report', description: 'Too many rows' }
      ])
    );
    assert.deepEqual(downloads, []);
    await waitFor(() => assert.equal(download.getAttribute('aria-busy'), null));
  });

  it('explains unknown reports without running anything', () => {
    const { client, runs } = fakeClient();
    showResults(client, 'nope', '');
    assert.ok(screen.getByText('There is no report called “nope”.'));
    assert.deepEqual(runs, []);
  });
});
