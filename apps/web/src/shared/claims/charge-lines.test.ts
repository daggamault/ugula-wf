import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PricedLine } from '@ugula/billing';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { ChargeLines } from './charge-lines.tsx';

const mileage: PricedLine = { code: 'A0425', units: 6.8, unitCents: 1_200, totalCents: 8_160 };
const als: PricedLine = { code: 'A0427', units: 1, unitCents: 80_000, totalCents: 80_000 };

const table = () => screen.getByRole('table', { name: 'Claim lines' });

const headers = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((h) => h.textContent);

const rows = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.lastElementChild?.textContent)
    );

describe('ChargeLines', () => {
  it('lists each HCPCS line with its units, unit price and amount', () => {
    render(createElement(ChargeLines, { lines: [als, mileage] }));
    assert.deepEqual(headers(), ['HCPCS', 'Units', 'Unit Price', 'Amount']);
    assert.deepEqual(rows(), [
      ['A0427', '1', '$800.00', '$800.00'],
      ['A0425', '6.8', '$12.00', '$81.60']
    ]);
  });

  it('describes each HCPCS code it has a description for', () => {
    render(
      createElement(ChargeLines, {
        lines: [als, mileage],
        codes: { hcpcs: { A0427: 'ALS1 emergency' } }
      })
    );
    assert.deepEqual(
      rows().map((r) => r[0]),
      ['ALS1 emergency A0427', 'A0425']
    );
  });

  it('shows an empty table without lines', () => {
    render(createElement(ChargeLines, { lines: [] }));
    assert.deepEqual(rows(), []);
  });
});
