import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../../shared/testing-dom.ts';
import type { ReportColumn } from './report-columns.ts';
import { ReportDocument } from './report-document.tsx';

type Row = { name: string; n: number };

const COLUMNS: ReportColumn<Row>[] = [
  { label: 'Payer', text: (r) => r.name, csv: (r) => r.name },
  {
    label: 'Share',
    isNumeric: true,
    text: (r, t) => `${(r.n / (t.n ?? 1)) * 100}%`,
    csv: (r) => r.n
  }
];

const show = (
  over: Partial<Parameters<typeof ReportDocument<Row>>[0]> = {}
): ReturnType<typeof render> =>
  render(
    createElement(ReportDocument<Row>, {
      title: 'Payer Performance',
      details: ['Dates of service', 'Run today'],
      columns: COLUMNS,
      rows: [
        { name: 'Medicare', n: 2 },
        { name: 'Aetna', n: 1 }
      ],
      totals: { n: 4 },
      footer: ['Total', '75%'],
      ...over
    })
  );

const texts = (els: HTMLElement[]) => els.map((e) => e.textContent);

const rowGroups = () => within(screen.getByRole('table')).getAllByRole('rowgroup');

describe('ReportDocument', () => {
  it('heads the report with its title and details', () => {
    show();
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Payer Performance' }));
    assert.ok(screen.getByText('Dates of service'));
    assert.ok(screen.getByText('Run today'));
  });

  it('labels each column', () => {
    show();
    assert.deepEqual(texts(screen.getAllByRole('columnheader')), ['Payer', 'Share']);
  });

  it('shows one row per report row, computed against the report totals', () => {
    show();
    const body = rowGroups()[1];
    assert.ok(body);
    assert.deepEqual(
      within(body)
        .getAllByRole('row')
        .map((r) => texts(within(r).getAllByRole('cell'))),
      [
        ['Medicare', '50%'],
        ['Aetna', '25%']
      ]
    );
  });

  it('closes the table with the totals row', () => {
    show();
    const groups = rowGroups();
    assert.equal(groups.length, 3);
    const foot = groups[2];
    assert.ok(foot);
    assert.deepEqual(texts(within(foot).getAllByRole('cell')), ['Total', '75%']);
  });

  it('leaves the totals row out without totals', () => {
    show({ footer: null });
    assert.equal(rowGroups().length, 2);
    assert.ok(!screen.queryByRole('cell', { name: 'Total' }));
  });

  it('shows an empty body for a report without rows', () => {
    show({ rows: [], footer: null });
    assert.deepEqual(texts(screen.getAllByRole('row')), ['PayerShare']);
  });

  it('sets only number columns in tabular figures', () => {
    show();
    const numeric = (el: HTMLElement) => el.classList.contains('tabular-nums');
    assert.deepEqual(screen.getAllByRole('columnheader').map(numeric), [false, true]);
    assert.deepEqual(screen.getAllByRole('cell').map(numeric), [
      false,
      true,
      false,
      true,
      false,
      true
    ]);
  });

  it('prints in black and gray without theme colors', () => {
    const { container } = show();
    const article = container.querySelector('article');
    assert.ok(article?.classList.contains('bg-white'));
    assert.ok(article?.classList.contains('text-black'));
    assert.doesNotMatch(container.innerHTML, /primary|success|warning|danger|info/);
  });
});
