import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import type { ClaimSummary } from '../../shared/claims/claim-detail.ts';
import { useLocation } from '../../shared/router.tsx';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, waitFor, within } from '../../shared/testing-dom.ts';
import type { Facets, Page } from '../../shared/url-state.ts';
import { ClaimsPage, ClaimsTable } from './claims-page.tsx';
import { type ClaimSearch, type ClaimsClient, claimSearchOf } from './client.ts';

const claim: ClaimSummary = {
  id: 'c1',
  number: '20261001-0012',
  patient_number: '20260915-0003',
  pcr_number: 'PCR-1001',
  encounter_number: '20261001-0007',
  level: 'ALS1',
  total_cents: 114_220,
  service_date: '2026-10-01',
  payers: ['Medicare', 'Blue Plan'],
  status: 'needs_review',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe'
};

const noSearch: ClaimSearch = { firstName: '', lastName: '', birthDate: '', number: '' };

const table = () => screen.getByRole('table', { name: 'Claims' });

const headers = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((h) => h.textContent);

const rows = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, -1)
        .map((c) => c.lastElementChild?.textContent)
    );

const marks = () => [...table().querySelectorAll('mark')].map((m) => m.textContent);

const showTable = (props: Partial<Parameters<typeof ClaimsTable>[0]> = {}) =>
  render(createElement(ClaimsTable, { claims: [claim], ...props }));

describe('ClaimsTable', () => {
  it('shows the claim, patient, encounter, total, payers and status columns', () => {
    showTable();
    assert.deepEqual(headers(), [
      'Claim',
      'Patient',
      'Encounter',
      'Service Date',
      'Total',
      'Payers',
      'Status',
      'Actions'
    ]);
    assert.deepEqual(rows(), [
      [
        '20261001-0012',
        'Doe, JanePatient 20260915-0003',
        '20261001-0007PCR PCR-1001',
        'Oct 1, 2026',
        '$1,142.20',
        'Medicare → Blue Plan',
        'Needs Review'
      ]
    ]);
    assert.deepEqual(marks(), []);
  });

  it('names a patient without a first name by the last name alone', () => {
    showTable({ claims: [{ ...claim, first_name: null }] });
    assert.equal(rows()[0]?.[1], 'DoePatient 20260915-0003');
  });

  it('opens each claim only from its icon action', () => {
    showTable({ claims: [claim, { ...claim, id: 'c2', number: '20261001-0013' }] });
    const [first, second] = within(table()).getAllByRole('row').slice(1);
    assert.ok(first && second);
    assert.deepEqual(
      within(first)
        .getAllByRole('link')
        .map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')]),
      [['Open claim 20261001-0012', '/claims/c1']]
    );
    assert.equal(
      within(second).getByRole('link', { name: 'Open claim 20261001-0013' }).getAttribute('href'),
      '/claims/c2'
    );
  });

  it('carries the way back to the list into the claim it opens', () => {
    showTable({ back: '/claims?lastName=doe' });
    assert.equal(
      screen.getByRole('link', { name: 'Open claim 20261001-0012' }).getAttribute('href'),
      '/claims/c1?back=%2Fclaims%3FlastName%3Ddoe'
    );
  });

  it('leaves out the patient column for a single patient', () => {
    showTable({ showPatient: false });
    assert.deepEqual(headers().slice(0, 3), ['Claim', 'Encounter', 'Service Date']);
    assert.equal(rows()[0]?.[1], '20261001-0007PCR PCR-1001');
  });

  it('bills the patient only when the claim has no payers', () => {
    showTable({ claims: [{ ...claim, payers: [] }] });
    assert.equal(rows()[0]?.[5], 'Patient only');
  });

  it('shows the PCR alone without an encounter, and a dash with neither', () => {
    showTable({
      claims: [
        { ...claim, encounter_number: null },
        { ...claim, id: 'c2', encounter_number: null, pcr_number: null }
      ]
    });
    assert.deepEqual(
      rows().map((r) => r[2]),
      ['—PCR PCR-1001', '—']
    );
  });

  it('highlights the claim, patient and encounter numbers a search names, ignoring separators', () => {
    const marked = (number: string) => {
      const { unmount } = showTable({ search: { ...noSearch, number } });
      const found = marks();
      unmount();
      return found;
    };
    assert.deepEqual(marked('#202610010012'), ['20261001-0012']);
    assert.deepEqual(marked('20260915-0003'), ['20260915-0003']);
    assert.deepEqual(marked('202610010007'), ['20261001-0007']);
  });

  it('highlights a PCR only when the search names all of it', () => {
    const { unmount } = showTable({ search: { ...noSearch, number: ' PCR-1001 ' } });
    assert.deepEqual(marks(), ['PCR-1001']);
    unmount();
    showTable({ search: { ...noSearch, number: 'PCR-10' } });
    assert.deepEqual(marks(), []);
  });

  it('highlights the start of the names a search names', () => {
    showTable({ search: { ...noSearch, lastName: 'do', firstName: 'ja' } });
    assert.deepEqual(marks(), ['Do', 'Ja']);
  });
});

const pageOf = (items: ClaimSummary[], facets?: Facets): Page<ClaimSummary> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...(facets ? { facets } : {})
});

const fakeClient = (list: () => Promise<Page<ClaimSummary>> = async () => pageOf([claim])) => {
  const calls: [Parameters<ClaimsClient['list']>[0], string][] = [];
  const client = {
    list: (query: Parameters<ClaimsClient['list']>[0], page: string) => {
      calls.push([query, page]);
      return list();
    }
  } as ClaimsClient;
  return { client, calls };
};

const Routed = ({ client }: { client: ClaimsClient }) =>
  createElement(ClaimsPage, {
    client,
    live: idleLive,
    search: claimSearchOf(useLocation().query)
  });

const show = (client: ClaimsClient, at = '/claims') => {
  window.history.replaceState(null, '', at);
  render(createElement(Routed, { client }));
  return userEvent.setup();
};

const searchClaims = () => screen.getByLabelText('Search Claims');

describe('ClaimsPage', () => {
  it('asks for a search first and loads no claims until there is one', () => {
    const { client, calls } = fakeClient();
    show(client);
    assert.deepEqual(
      within(searchClaims())
        .getAllByRole('searchbox')
        .map((f) => f.id),
      ['search-firstName', 'search-lastName', 'search-number']
    );
    assert.equal(within(searchClaims()).getByLabelText('Birth Date').getAttribute('type'), 'date');
    assert.ok(
      screen.getByText(
        'Enter a name, birth date, or a claim, patient or encounter number. Names match from the start.'
      )
    );
    assert.ok(!screen.queryByRole('table'));
    assert.deepEqual(calls, []);
  });

  it('searches every claim by what was entered and highlights it', async () => {
    const { client, calls } = fakeClient();
    const user = show(client);
    await user.type(within(searchClaims()).getByLabelText('Last Name'), 'doe');
    await user.type(within(searchClaims()).getByLabelText('Number'), ' 20261001-0012 ');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('table', { name: 'Claims' });
    assert.equal(window.location.search, '?lastName=doe&number=20261001-0012');
    assert.deepEqual(calls, [
      [
        { firstName: '', lastName: 'doe', birthDate: '', number: '20261001-0012' },
        'page=1&pageSize=25&sort=created&dir=desc'
      ]
    ]);
    assert.deepEqual(marks(), ['20261001-0012', 'Doe']);
    assert.equal(
      screen.getByRole('link', { name: 'Open claim 20261001-0012' }).getAttribute('href'),
      '/claims/c1?back=%2Fclaims%3FlastName%3Ddoe%26number%3D20261001-0012'
    );
  });

  it('says when no claim matches the search', async () => {
    const { client } = fakeClient(async () => pageOf([]));
    show(client, '/claims?lastName=zz');
    assert.ok(await screen.findByRole('heading', { name: 'No Matching Claims' }));
    assert.ok(
      screen.getByText(
        'Names match from the start, so “Sm” finds Smith. Try fewer letters or another number.'
      )
    );
    assert.ok(!screen.queryByRole('table'));
  });

  it('says why the claims could not be loaded', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('Network down');
    });
    show(client, '/claims?lastName=doe');
    assert.equal((await screen.findByRole('alert')).textContent, 'Network down');
    assert.ok(!screen.queryByRole('heading', { name: 'No Matching Claims' }));
  });

  it('lists claims by filters alone and offers to clear filters that match nothing', async () => {
    const { client, calls } = fakeClient(async () => pageOf([]));
    show(client, '/claims?status=needs_review');
    assert.ok(await screen.findByRole('heading', { name: 'No Matching Claims' }));
    assert.equal(
      screen.getByRole('link', { name: 'Clear Filters' }).getAttribute('href'),
      '/claims'
    );
    assert.deepEqual(calls[0], [
      { firstName: '', lastName: '', birthDate: '', number: '' },
      'page=1&pageSize=25&sort=created&dir=desc&status=needs_review'
    ]);
  });

  it('sorts by the encounter number, newest first', async () => {
    const { client, calls } = fakeClient();
    const user = show(client, '/claims?lastName=doe');
    await screen.findByRole('table', { name: 'Claims' });
    await user.click(within(table()).getByRole('link', { name: 'Encounter' }));
    await waitFor(() => assert.equal(calls.length, 2));
    assert.equal(window.location.search, '?lastName=doe&sort=encounter&dir=desc');
    assert.equal(calls[1]?.[1], 'page=1&pageSize=25&sort=encounter&dir=desc');
    await waitFor(() =>
      assert.equal(
        within(table()).getByRole('columnheader', { name: 'Encounter' }).getAttribute('aria-sort'),
        'descending'
      )
    );
  });
});
