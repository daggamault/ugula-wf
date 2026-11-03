import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { CLAIM_SEARCH_FIELDS, ClaimsPage, ClaimsTable, claimNumber } from './claims-page.tsx';
import type { ClaimSummary, ClaimsClient } from './client.ts';

const claim: ClaimSummary = {
  id: 'c1',
  number: 12,
  patient_number: 3,
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 30_000,
  service_date: '2026-10-01',
  payers: ['Medicare', 'Blue Plan'],
  status: 'submitted',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe'
};

describe('ClaimsTable', () => {
  it('opens each claim from an icon action and shows the patient, encounter, money and status', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim, { ...claim, id: 'c2', payers: [] }] })
    );
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('href="/claims/c1" aria-label="Open claim #12"'));
    assert.equal(html.split('href="/claims/c1"').length, 2);
    assert.ok(html.includes('>#12<') && html.includes('Patient #3'));
    assert.ok(html.includes('Doe, Jane') && html.includes('PCR-1001'));
    assert.ok(html.includes('$1,142.20') && html.includes('$300.00'));
    assert.ok(html.includes('Medicare → Blue Plan') && html.includes('Patient only'));
    assert.ok(html.includes('>Submitted<'));
    const own = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim], showPatient: false })
    );
    assert.ok(!own.includes('Doe, Jane'));
  });

  it('numbers claims and patients with a #', () => {
    assert.equal(claimNumber(7), '#7');
  });
});

describe('ClaimsPage', () => {
  it('filters by name, birth date, number and status, defaulting to open claims', () => {
    assert.deepEqual(
      CLAIM_SEARCH_FIELDS.map((f) => f.name),
      ['firstName', 'lastName', 'birthDate', 'number', 'status']
    );
    const pending = () => new Promise(() => undefined);
    const html = renderToStaticMarkup(
      createElement(ClaimsPage, {
        client: { list: pending } as unknown as ClaimsClient,
        live: idleLive,
        search: { status: 'open', firstName: '', lastName: '', birthDate: '', number: '' }
      })
    );
    assert.ok(html.includes('aria-expanded="true"') && html.includes('>Filters'));
    assert.ok(html.includes('<option value="needs_review">Needs Review</option>'));
    assert.ok(html.includes('for="search-number"') && html.includes('for="search-birthDate"'));
    assert.ok(!html.includes('837P'));
  });
});
