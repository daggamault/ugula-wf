import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChargeLines } from './charge-lines.tsx';

describe('ChargeLines', () => {
  it('lists each HCPCS line with its units and prices', () => {
    const html = renderToStaticMarkup(
      createElement(ChargeLines, {
        lines: [{ code: 'A0425', units: 6.8, unitCents: 1_200, totalCents: 8_160 }]
      })
    );
    assert.ok(html.includes('A0425') && html.includes('6.8'));
    assert.ok(html.includes('$12.00') && html.includes('$81.60'));
  });
});
