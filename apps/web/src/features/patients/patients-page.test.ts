import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen, userEvent, within } from '../../shared/testing-dom.ts';
import type { PatientSearch, PatientSummary, PatientsClient } from './client.ts';
import { PatientsPage, PatientsTable, placeOf } from './patients-page.tsx';

const patient: PatientSummary = {
  id: 'p1',
  number: '20260915-0003',
  first_name: 'Jane',
  last_name: 'Doe',
  birth_date: '1958-04-12',
  gender: 'F',
  address_line: '1 Main St',
  city: 'Erie',
  state: 'PA',
  postal_code: '16501',
  claim_count: 2,
  balance_cents: 30_000,
  last_service_date: '2026-10-01'
};

describe('PatientsTable', () => {
  it('opens each patient from an icon action and shows birth date, place, claims and balance', () => {
    const html = renderToStaticMarkup(createElement(PatientsTable, { patients: [patient] }));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/patients/p1" aria-label="Open patient Doe, Jane"'));
    assert.equal(html.split('href="/patients/p1"').length, 2);
    assert.ok(html.includes('Erie, PA') && html.includes('$300.00'));
    assert.ok(html.includes('>Number<') && html.includes('>20260915-0003<'));
    assert.ok(!html.includes('<mark'));
    assert.equal(placeOf({ city: null, state: null }), null);
  });

  it('highlights searched names and returns opened patients to the searched list', () => {
    const html = renderToStaticMarkup(
      createElement(PatientsTable, {
        patients: [patient],
        back: '/patients?lastName=do',
        search: { lastName: 'do', firstName: '', birthDate: '', number: '' }
      })
    );
    assert.match(html, /<mark[^>]*>Do<\/mark>e/);
    assert.ok(html.includes('href="/patients/p1?back=%2Fpatients%3FlastName%3Ddo"'));
    assert.ok(html.includes('>Open</span>'));
  });
});

describe('PatientsTable search highlights', () => {
  it('highlights the patient number and birth date the search names', () => {
    const html = renderToStaticMarkup(
      createElement(PatientsTable, {
        patients: [patient],
        search: { lastName: '', firstName: '', birthDate: '1958-04-12', number: '#202609150003' }
      })
    );
    assert.match(html, /<mark[^>]*>20260915-0003<\/mark>/);
    assert.match(html, /<mark[^>]*>[^<]*1958<\/mark>/);
  });
});

describe('PatientsPage', () => {
  const none = { lastName: '', firstName: '', birthDate: '', number: '' };

  const fakeClient = (over: Partial<PatientsClient> = {}) => {
    const calls: [PatientSearch, string][] = [];
    const client = {
      list: async (search: PatientSearch, page: string) => {
        calls.push([search, page]);
        return { items: [patient], total: 1, page: 1, pageSize: 25 };
      },
      ...over
    } as PatientsClient;
    return { client, calls };
  };

  const show = (client: PatientsClient, search: PatientSearch = none) =>
    render(createElement(PatientsPage, { client, live: idleLive, search }));

  it('asks for a name, birth date or number before listing anyone', () => {
    const { client, calls } = fakeClient();
    show(client, { ...none, lastName: ' ' });
    assert.ok(screen.getByText(/Enter a last name, first name, birth date or patient number/));
    assert.ok(!screen.queryByRole('table'));
    assert.equal((screen.getByLabelText('Birth Date') as HTMLInputElement).type, 'date');
    assert.deepEqual(calls, []);
  });

  it('puts the typed search in the address bar', async () => {
    const { client } = fakeClient();
    show(client);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Last Name' }), ' Doe ');
    await user.type(screen.getByRole('searchbox', { name: 'Patient Number' }), '20260915-0003');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    assert.equal(window.location.pathname, '/patients');
    assert.equal(
      new URLSearchParams(window.location.search).toString(),
      'lastName=Doe&number=20260915-0003'
    );
  });

  it('lists the patients the search finds and opens them back to the search', async () => {
    window.history.replaceState(null, '', '/patients?lastName=do');
    const { client, calls } = fakeClient();
    const search = { ...none, lastName: 'do' };
    show(client, search);
    const table = await screen.findByRole('table', { name: 'Patients' });
    assert.equal(
      within(table).getByRole('link', { name: 'Open patient Doe, Jane' }).getAttribute('href'),
      '/patients/p1?back=%2Fpatients%3FlastName%3Ddo'
    );
    assert.deepEqual(calls, [[search, 'page=1&pageSize=25&sort=name&dir=asc']]);
  });

  it('clears the search', async () => {
    window.history.replaceState(null, '', '/patients?lastName=do&page=2');
    const { client } = fakeClient();
    show(client, { ...none, lastName: 'do' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }));
    assert.equal(`${window.location.pathname}${window.location.search}`, '/patients');
  });

  it('explains how names match when nobody is found', async () => {
    const { client } = fakeClient({
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 25 })
    });
    show(client, { ...none, firstName: 'Zed' });
    assert.ok(await screen.findByText('No Matching Patients'));
    assert.ok(screen.getByText(/“Sm” finds Smith/));
  });

  it('says why the search failed', async () => {
    const { client } = fakeClient({ list: () => Promise.reject(new Error('Server unavailable')) });
    show(client, { ...none, number: '20260915-0003' });
    assert.equal((await screen.findByRole('alert')).textContent, 'Server unavailable');
  });
});
