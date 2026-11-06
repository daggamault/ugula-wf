import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimSummaryPanel, pricedLinesOf } from './claim-summary.tsx';
import { claimDetail } from './testing.ts';

describe('pricedLinesOf', () => {
  it('turns stored claim lines into priced lines', () => {
    assert.deepEqual(
      pricedLinesOf([
        { position: 1, code: 'A0425', units: 6.8, unit_cents: 1_200, total_cents: 8_160 }
      ]),
      [{ code: 'A0425', units: 6.8, unitCents: 1_200, totalCents: 8_160 }]
    );
  });
});

describe('ClaimSummaryPanel', () => {
  it('shows what was billed, what is owed and the transport', () => {
    const html = renderToStaticMarkup(createElement(ClaimSummaryPanel, { claim: claimDetail }));
    assert.ok(html.includes('>Summary</h2>') && html.includes('Emergency Transport'));
    assert.ok(html.includes('$1,142.20') && html.includes('ALS1'));
    const bare = renderToStaticMarkup(
      createElement(ClaimSummaryPanel, {
        claim: { ...claimDetail, classification: null, level: null, facility_name: null }
      })
    );
    assert.ok(bare.includes('None: the payers and the patient'));
  });
});
