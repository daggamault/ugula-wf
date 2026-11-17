import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen } from '../../shared/testing-dom.ts';
import type { PatientSummary, PatientsClient } from './client.ts';
import { PatientDetails, PatientPage } from './patient-page.tsx';

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

describe('PatientDetails', () => {
  it('shows the balance, sex and full address', () => {
    const html = renderToStaticMarkup(createElement(PatientDetails, { patient }));
    assert.ok(html.includes('Female') && html.includes('$300.00'));
    assert.ok(html.includes('Patient Number') && html.includes('20260915-0003'));
    assert.ok(html.includes('1 Main St, Erie, PA 16501'));
  });

  it('shows an empty address when none is on file', () => {
    const none = { address_line: null, city: null, state: null, postal_code: null };
    const html = renderToStaticMarkup(
      createElement(PatientDetails, { patient: { ...patient, ...none } })
    );
    assert.match(html, /Address<\/dt><dd[^>]*>—<\/dd>/);
  });

  it('shows an empty value for a blank or unknown sex', () => {
    for (const gender of ['', 'X']) {
      const html = renderToStaticMarkup(
        createElement(PatientDetails, { patient: { ...patient, gender } })
      );
      assert.match(html, /Sex<\/dt><dd[^>]*>—<\/dd>/);
    }
  });
});

describe('PatientPage', () => {
  const show = (find: PatientsClient['find']) =>
    render(
      createElement(PatientPage, {
        client: { find } as PatientsClient,
        live: idleLive,
        patientId: 'p1',
        back: '/patients?lastName=do',
        claims: createElement('section', { 'aria-label': 'Claims' })
      })
    );

  it('loads the patient and shows their details above their claims', async () => {
    const asked: string[] = [];
    show(async (id) => {
      asked.push(id);
      return patient;
    });
    assert.ok(screen.getByRole('status', { name: 'Loading' }));
    assert.ok(await screen.findByRole('heading', { name: 'Doe, Jane' }));
    assert.ok(screen.getByRole('region', { name: 'Claims' }));
    assert.equal(
      screen.getByRole('link', { name: 'Back to Patients' }).getAttribute('href'),
      '/patients?lastName=do'
    );
    assert.deepEqual(asked, ['p1']);
  });

  it('says why the patient could not load', async () => {
    show(() => Promise.reject(new Error('Patient not found')));
    assert.ok(await screen.findByText('Patient not found'));
    assert.ok(!screen.queryByRole('region', { name: 'Claims' }));
  });
});
