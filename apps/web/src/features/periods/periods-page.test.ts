import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../../shared/format.ts';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Period, PeriodsClient } from './client.ts';
import { PeriodsPage } from './periods-page.tsx';

const listed: Period[] = [
  { period_on: '2026-10-01', closed_at: '2026-11-01T14:00:00Z', closed_by: 'ann@example.com' },
  { period_on: '2026-09-01', closed_at: '2026-10-01T14:00:00Z', closed_by: null }
];

const fakeClient = (items = listed) => {
  const queries: string[] = [];
  const client: PeriodsClient = {
    search: async (query: string) => {
      queries.push(query);
      return { items, total: items.length, page: 1, pageSize: 25 };
    }
  };
  return { client, queries };
};

const show = (client: PeriodsClient) => {
  window.history.replaceState(null, '', '/periods');
  render(createElement(PeriodsPage, { client, live: idleLive }));
};

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.lastElementChild?.textContent);

describe('PeriodsPage', () => {
  it('lists the closed months newest first with who closed them', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const rows = within(
      await screen.findByRole('table', { name: 'Accounting periods' })
    ).getAllByRole('row');
    assert.deepEqual(
      rows.slice(1).map((r) => cellsOf(r)),
      [
        ['October 2026', formatDateTime('2026-11-01T14:00:00Z'), 'ann@example.com'],
        ['September 2026', formatDateTime('2026-10-01T14:00:00Z'), '—']
      ]
    );
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=period&dir=desc']);
  });

  it('sorts oldest first on the server', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await screen.findByRole('table', { name: 'Accounting periods' });
    await userEvent
      .setup()
      .click(within(screen.getByRole('columnheader', { name: 'Period' })).getByRole('link'));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'page=1&pageSize=25&sort=period&dir=asc');
  });

  it('says how months get closed when none are', async () => {
    show(fakeClient([]).client);
    assert.ok(await screen.findByRole('heading', { name: 'No Closed Periods' }));
    assert.ok(screen.getByText(/Close Period opens a task/));
  });
});
