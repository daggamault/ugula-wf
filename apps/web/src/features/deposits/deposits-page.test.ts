import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { AccessProvider } from '../../shared/access.tsx';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Page } from '../../shared/url-state.ts';
import type { Deposit, DepositsClient } from './client.ts';
import { DepositsPage } from './deposits-page.tsx';

const deposit = (patch: Partial<Deposit> = {}): Deposit => ({
  id: 'd1',
  trace_number: '1234567890',
  amount_cents: 60_000,
  deposited_on: '2026-11-02',
  payer_name: 'Medicare',
  note: null,
  payer_file_id: 'f1',
  file_name: 'era.835',
  payment_cents: 60_000,
  paid_on: '2026-10-30',
  created_by: 'ann@example.com',
  created_at: '2026-11-02T15:00:00Z',
  ...patch
});

const listed = [
  deposit(),
  deposit({
    id: 'd2',
    trace_number: '555',
    amount_cents: 12_500,
    deposited_on: '2026-11-03',
    payer_name: null,
    payer_file_id: null,
    file_name: null,
    payment_cents: null,
    paid_on: null
  })
];

const pageOf = (items: Deposit[]): Page<Deposit> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (items = listed) => {
  const queries: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf(items);
    }
  } as DepositsClient;
  return { client, queries };
};

const show = (client: DepositsClient, permissions: Permission[] = ['payer_files:create']) =>
  render(
    createElement(AccessProvider, {
      access: {
        agencyId: 'a1',
        agencyName: 'North EMS',
        organizationId: 'o1',
        organizationName: 'Acme',
        userId: 'u1',
        isOrganizationAdmin: false,
        permissions
      },
      children: createElement(DepositsPage, { client, live: idleLive })
    })
  );

const table = () => screen.findByRole('table', { name: 'Deposits' });

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .slice(0, 5)
    .map((c) => c.lastElementChild?.textContent);

describe('DepositsPage', () => {
  it('lists deposits with their remittance or that they are unmatched', async () => {
    window.history.replaceState(null, '', '/deposits');
    const { client, queries } = fakeClient();
    show(client);
    const rows = within(await table()).getAllByRole('row');
    assert.deepEqual(
      rows.slice(1).map((r) => cellsOf(r)),
      [
        ['1234567890', 'Medicare', 'Nov 2, 2026', '$600.00', 'era.835'],
        ['555', '—', 'Nov 3, 2026', '$125.00', 'Unmatched']
      ]
    );
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=deposited&dir=desc']);
    assert.equal(
      screen.getByRole('link', { name: 'Open deposit 555' }).getAttribute('href'),
      '/deposits/d2'
    );
  });

  it('searches deposits on the server', async () => {
    window.history.replaceState(null, '', '/deposits');
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '555');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'q=555&page=1&pageSize=25&sort=deposited&dir=desc');
  });

  it('sorts deposits by amount', async () => {
    window.history.replaceState(null, '', '/deposits');
    const { client, queries } = fakeClient();
    show(client);
    await table();
    await userEvent
      .setup()
      .click(within(screen.getByRole('columnheader', { name: 'Amount' })).getByRole('link'));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'page=1&pageSize=25&sort=amount&dir=desc');
  });

  it('offers to record a deposit only to those who may upload payer files', async () => {
    window.history.replaceState(null, '', '/deposits');
    show(fakeClient().client);
    await table();
    assert.equal(
      screen.getByRole('link', { name: 'Record Deposit' }).getAttribute('href'),
      '/deposits/new'
    );
  });

  it('hides recording from those who may only read', async () => {
    window.history.replaceState(null, '', '/deposits');
    show(fakeClient().client, ['payer_files:read']);
    await table();
    assert.equal(screen.queryByRole('link', { name: 'Record Deposit' }), null);
  });

  it('suggests recording a deposit when there are none', async () => {
    window.history.replaceState(null, '', '/deposits');
    show(fakeClient([]).client);
    assert.ok(await screen.findByRole('heading', { name: 'No Deposits Yet' }));
    assert.equal(screen.getAllByRole('link', { name: 'Record Deposit' }).length, 2);
  });
});
