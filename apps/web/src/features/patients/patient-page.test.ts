import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { PatientSummary, PatientsClient } from './client.ts';
import { addressOf, PatientDetails, PatientPage } from './patient-page.tsx';

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

describe('PatientDetails', () => {
  it('shows the balance, sex and full address', () => {
    const html = renderToStaticMarkup(createElement(PatientDetails, { patient }));
    assert.ok(html.includes('Female') && html.includes('$300.00'));
    assert.equal(addressOf(patient), '1 Main St, Erie, PA 16501');
  });

  it('joins only the address parts on file', () => {
    const none = { address_line: null, city: null, state: null, postal_code: null };
    assert.equal(addressOf({ ...patient, ...none }), '');
    assert.equal(addressOf({ ...patient, ...none, state: 'PA', postal_code: '16501' }), 'PA 16501');
    assert.equal(addressOf({ ...patient, city: null }), '1 Main St, PA 16501');
    assert.equal(addressOf({ ...patient, address_line: null, postal_code: null }), 'Erie, PA');
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
  it('waits for the patient before rendering', () => {
    const html = renderToStaticMarkup(
      createElement(PatientPage, {
        client: { find: () => new Promise(() => undefined) } as unknown as PatientsClient,
        live: idleLive,
        patientId: 'p1',
        claims: null
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });
});
