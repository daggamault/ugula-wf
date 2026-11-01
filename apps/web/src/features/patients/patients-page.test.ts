import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApi } from '../../shared/api.ts';
import type { PatientSummary, PatientsClient } from './client.ts';
import { createPatientsClient, searchOf } from './client.ts';
import { addressOf, PatientDetails } from './patient-page.tsx';
import { PatientsPage, PatientsTable, placeOf } from './patients-page.tsx';

const patient: PatientSummary = {
  id: 'p1',
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

describe('createPatientsClient', () => {
  it('searches by the fields given and opens one patient', async () => {
    const seen: string[] = [];
    const client = createPatientsClient(
      createApi('', async (url) => {
        seen.push(String(url));
        return new Response('{"patient":{"id":"p1"},"items":[]}', { status: 200 });
      })
    );
    await client.list({ lastName: ' Doe ', firstName: '', birthDate: '1958-04-12' }, 'page=1');
    await client.list({ lastName: '', firstName: '', birthDate: '' }, 'page=2');
    assert.deepEqual(await client.find('p1'), { id: 'p1' });
    assert.deepEqual(seen, [
      '/api/patients?lastName=Doe&birthDate=1958-04-12&page=1',
      '/api/patients?page=2',
      '/api/patients/p1'
    ]);
    assert.deepEqual(searchOf(new URLSearchParams('lastName=doe')), {
      lastName: 'doe',
      firstName: '',
      birthDate: ''
    });
  });
});

describe('PatientsTable', () => {
  it('links each patient with birth date, place, claims and balance', () => {
    const html = renderToStaticMarkup(createElement(PatientsTable, { patients: [patient] }));
    assert.ok(html.includes('href="/patients/p1"') && html.includes('Doe, Jane'));
    assert.ok(html.includes('Erie, PA') && html.includes('$300.00'));
    assert.equal(placeOf({ city: null, state: null }), null);
  });
});

describe('PatientsPage', () => {
  it('searches by last name, first name and birth date', () => {
    const html = renderToStaticMarkup(
      createElement(PatientsPage, {
        client: { list: () => new Promise(() => undefined) } as unknown as PatientsClient,
        search: { lastName: '', firstName: '', birthDate: '' }
      })
    );
    assert.ok(html.includes('<search'));
    assert.ok(html.includes('Last name') && html.includes('First name'));
    assert.ok(html.includes('type="date"'));
  });
});

describe('PatientDetails', () => {
  it('shows the balance, sex and full address', () => {
    const html = renderToStaticMarkup(createElement(PatientDetails, { patient }));
    assert.ok(html.includes('Female') && html.includes('$300.00'));
    assert.equal(addressOf(patient), '1 Main St, Erie, PA 16501');
  });
});
