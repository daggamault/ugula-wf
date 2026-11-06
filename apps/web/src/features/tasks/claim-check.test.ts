import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeCheck } from '@ugula/billing/testing';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimCheckView, isClaimCheck, placeText } from './claim-check.tsx';

describe('claim check', () => {
  it('recognizes a claim check by its lines, payers and details', () => {
    assert.equal(isClaimCheck({ lines: [], payers: [], details: {} }), true);
    assert.equal(isClaimCheck({ trip: {} }), false);
    assert.equal(isClaimCheck(null), false);
  });

  it('writes a place on one line', () => {
    assert.equal(
      placeText({
        name: 'General',
        addressLine: '2 Elm',
        city: 'Town',
        state: 'VT',
        postalCode: '05401'
      }),
      'General, 2 Elm, Town, VT 05401'
    );
    assert.equal(
      placeText({ addressLine: null, city: 'Town', state: null, postalCode: '05401' }),
      'Town, 05401'
    );
    assert.equal(placeText(null), '—');
  });
});

describe('ClaimCheckView', () => {
  it('shows the claim with Title Cased labels, money, miles and payers', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimCheckView, { claim: completeCheck(['Medicare']) })
    );
    assert.ok(html.includes('>Date of Service<') && html.includes('>Loaded Miles<'));
    assert.ok(html.includes('$1,000.00') && html.includes('7.3 miles'));
    assert.ok(html.includes('Emergency Transport') && html.includes('ALS1, emergency'));
    assert.ok(html.includes('aria-label="Payers on the claim"'));
    assert.ok(
      html.includes('M-Medicare') && html.includes('>Self<') && html.includes('The patient')
    );
    assert.ok(html.includes('A0427'));
  });

  it('says when a claim has no charges or payers and leaves unknown values blank', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimCheckView, {
        claim: {
          ...completeCheck([]),
          lines: [],
          classification: 'custom',
          emergency: false,
          loadedMiles: null,
          level: null
        }
      })
    );
    assert.ok(html.includes('No charge lines.'));
    assert.ok(html.includes('No payers, so the patient is billed.'));
    assert.ok(html.includes('>custom<') && html.includes('—, non-emergency'));
  });
});
