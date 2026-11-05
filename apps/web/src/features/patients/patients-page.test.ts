import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { PatientSummary, PatientsClient } from './client.ts';
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
  it('searches by last name, first name and birth date', () => {
    const html = renderToStaticMarkup(
      createElement(PatientsPage, {
        live: idleLive,
        client: { list: () => new Promise(() => undefined) } as unknown as PatientsClient,
        search: { lastName: '', firstName: '', birthDate: '', number: '' }
      })
    );
    assert.ok(
      html.includes(
        '<search aria-label="Search patients" class="border-border bg-surface rounded-xl border p-5">'
      )
    );
    assert.ok(html.includes('Names match from the start.'));
    assert.ok(html.includes('Last Name') && html.includes('First Name'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('Patient Number') && html.includes('placeholder="20261105-0001"'));
  });

  it('lists no patients until something is searched for', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as PatientsClient;
    const idle = renderToStaticMarkup(
      createElement(PatientsPage, {
        live: idleLive,
        client,
        search: { lastName: ' ', firstName: '', birthDate: '', number: '' }
      })
    );
    assert.ok(!idle.includes('aria-label="Patients"') && !idle.includes('No Patients'));
    assert.ok(!idle.includes('role="status"'));
    const searching = renderToStaticMarkup(
      createElement(PatientsPage, {
        live: idleLive,
        client,
        search: { lastName: 'kli', firstName: '', birthDate: '', number: '' }
      })
    );
    assert.ok(searching.includes('role="status"'));
    const byNumber = renderToStaticMarkup(
      createElement(PatientsPage, {
        live: idleLive,
        client,
        search: { lastName: '', firstName: '', birthDate: '', number: '20260915-0003' }
      })
    );
    assert.ok(byNumber.includes('role="status"'));
  });
});
