import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimsTable } from './claims-page.tsx';
import type { ClaimSummary } from './client.ts';

const claim: ClaimSummary = {
  id: 'c1',
  pcr_number: 'PCR-1001',
  level: 'ALS1',
  total_cents: 114_220,
  balance_cents: 30_000,
  payers: ['Medicare', 'Blue Plan'],
  status: 'open',
  created_at: '2026-10-01T00:00:00Z',
  first_name: 'Jane',
  last_name: 'Doe'
};

describe('ClaimsTable', () => {
  it('links each claim and shows money, payer order and status', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimsTable, { claims: [claim, { ...claim, id: 'c2', payers: [] }] })
    );
    assert.ok(html.includes('href="/claims/c1"'));
    assert.ok(html.includes('Doe, Jane'));
    assert.ok(html.includes('$1,142.20'));
    assert.ok(html.includes('$300.00'));
    assert.ok(html.includes('Medicare → Blue Plan'));
    assert.ok(html.includes('None yet'));
    assert.ok(html.includes('>Open<'));
  });
});
