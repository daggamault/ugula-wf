import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import { type ToastInput, ToastProvider } from '../../shared/ui/toast.tsx';
import type { Page } from '../../shared/url-state.ts';
import type { FacilitiesClient, Facility } from './client.ts';
import { FacilitiesPage, placeOf } from './facilities-page.tsx';

const facility = (patch: Partial<Facility>): Facility => ({
  id: 'f1',
  name: 'Sunrise SNF',
  address_line: '5 Elm St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62702',
  phone: null,
  kind: 'snf',
  has_contract: true,
  contract_note: null,
  balance_cents: 125_000,
  ...patch
});

const listed = [
  facility({}),
  facility({
    id: 'f2',
    name: 'Mercy Hospital',
    address_line: null,
    city: null,
    state: null,
    kind: 'hospital',
    has_contract: false,
    balance_cents: 0
  })
];

const pageOf = (items: Facility[]): Page<Facility> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25
});

const fakeClient = (over: Partial<FacilitiesClient> = {}) => {
  const queries: string[] = [];
  const removed: string[] = [];
  const client = {
    search: async (query: string) => {
      queries.push(query);
      return pageOf(listed);
    },
    remove: async (id: string) => {
      removed.push(id);
      return { id };
    },
    ...over
  } as FacilitiesClient;
  return { client, queries, removed };
};

const show = (client: FacilitiesClient) => {
  const toasts: ToastInput[] = [];
  render(
    createElement(
      ToastProvider,
      { onNotify: (t) => toasts.push(t) },
      createElement(FacilitiesPage, { client, live: idleLive })
    )
  );
  return toasts;
};

const table = () => screen.findByRole('table', { name: 'Facilities' });

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .slice(0, 4)
    .map((c) => c.lastElementChild?.textContent);

const confirmDelete = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Delete Sunrise SNF' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Sunrise SNF?' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
};

describe('FacilitiesPage', () => {
  it('lists facilities with their place, kind and what they owe', async () => {
    const { client, queries } = fakeClient();
    show(client);
    const rows = within(await table()).getAllByRole('row');
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.slice(1).map((r) => cellsOf(r)),
      [
        [
          'Sunrise SNF',
          '5 Elm St · Springfield, IL',
          'Skilled nursing facility · contract',
          '$1,250.00'
        ],
        ['Mercy Hospital', '', 'Hospital', '$0.00']
      ]
    );
    assert.deepEqual(queries, ['page=1&pageSize=25&sort=name&dir=asc']);
  });

  it('searches facilities by name and highlights the match', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'sun');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => assert.equal(queries.length, 2));
    assert.deepEqual(queries, [
      'page=1&pageSize=25&sort=name&dir=asc',
      'q=sun&page=1&pageSize=25&sort=name&dir=asc'
    ]);
    assert.equal(window.location.search, '?q=sun');
    await waitFor(() => assert.equal(document.querySelector('mark')?.textContent, 'Sun'));
    assert.equal(
      screen.getByRole('link', { name: 'Edit Sunrise SNF' }).getAttribute('href'),
      '/facilities/f1?back=%2Ffacilities%3Fq%3Dsun'
    );
  });

  it('sorts facilities by city', async () => {
    const { client, queries } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('columnheader', { name: 'Address' })).getByRole('link')
    );
    await waitFor(() => assert.equal(queries.length, 2));
    assert.equal(queries[1], 'page=1&pageSize=25&sort=city&dir=asc');
  });

  it('offers to add a facility that returns to the searched list', async () => {
    window.history.replaceState(null, '', '/facilities?q=sun');
    const { client } = fakeClient();
    show(client);
    await table();
    assert.equal(
      screen.getByRole('link', { name: 'Add Facility' }).getAttribute('href'),
      '/facilities/new?back=%2Ffacilities%3Fq%3Dsun'
    );
  });

  it('suggests adding a facility when there are none', async () => {
    const { client } = fakeClient({ search: async () => pageOf([]) });
    show(client);
    assert.ok(await screen.findByRole('heading', { name: 'No Facilities Yet' }));
    assert.equal(screen.getAllByRole('link', { name: 'Add Facility' }).length, 2);
  });

  it('deletes a facility once confirmed and reloads the list', async () => {
    const { client, queries, removed } = fakeClient();
    const toasts = show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Sunrise SNF' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Sunrise SNF?' });
    assert.ok(
      within(dialog).getByText(
        'Claims Sunrise SNF is responsible for go back to their payers and the patient.'
      )
    );
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => assert.deepEqual(toasts, [{ title: 'Sunrise SNF deleted' }]));
    assert.deepEqual(removed, ['f1']);
    await waitFor(() => assert.equal(queries.length, 2));
  });

  it('keeps the facility when the deletion is not confirmed', async () => {
    const { client, removed } = fakeClient();
    show(client);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Sunrise SNF' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Sunrise SNF?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }));
    assert.equal(dialog.hasAttribute('open'), false);
    assert.deepEqual(removed, []);
  });

  it('says why a facility could not be deleted', async () => {
    const { client, queries } = fakeClient({
      remove: async () => {
        throw new Error('Facility has open invoices');
      }
    });
    const toasts = show(client);
    await table();
    await confirmDelete(userEvent.setup());
    await waitFor(() =>
      assert.deepEqual(toasts, [
        {
          intent: 'danger',
          title: 'Could not delete facility',
          description: 'Facility has open invoices'
        }
      ])
    );
    assert.equal(queries.length, 1);
  });
});

describe('placeOf', () => {
  it('joins the street with the city and state', () => {
    assert.equal(
      placeOf({ address_line: '5 Elm St', city: 'Springfield', state: 'IL' }),
      '5 Elm St · Springfield, IL'
    );
  });

  it('leaves out whatever part of the address is missing', () => {
    assert.equal(placeOf({ address_line: null, city: 'Springfield', state: null }), 'Springfield');
    assert.equal(placeOf({ address_line: '5 Elm St', city: null, state: 'IL' }), '5 Elm St · IL');
    assert.equal(placeOf({ address_line: null, city: null, state: null }), '');
  });
});
