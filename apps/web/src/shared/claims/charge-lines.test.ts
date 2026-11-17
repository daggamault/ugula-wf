import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { ChargeLines } from './charge-lines.tsx';
import type { ClaimLine } from './claim-detail.ts';

const als: ClaimLine = {
  position: 1,
  code: 'A0427',
  modifiers: ['RH'],
  units: 1,
  unit_cents: 80_000,
  total_cents: 80_000
};

const mileage: ClaimLine = {
  position: 2,
  code: 'A0425',
  modifiers: [],
  units: 6.8,
  unit_cents: 1_200,
  total_cents: 8_160
};

const table = () => screen.getByRole('table', { name: 'Claim lines' });

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
  it('lists each HCPCS line with its modifiers, units, unit price and amount', () => {
    render(createElement(ChargeLines, { lines: [als, mileage] }));
    assert.deepEqual(
      within(table())
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
      ['HCPCS', 'Modifiers', 'Units', 'Unit Price', 'Amount']
    );
    assert.deepEqual(rows(), [
      ['A0427', 'RH', '1', '$800.00', '$800.00'],
      ['A0425', '—', '6.8', '$12.00', '$81.60']
    ]);
  });

  it('reads stored units given as text', () => {
    const stored = { ...mileage, units: '6.8' as unknown as number };
    render(createElement(ChargeLines, { lines: [stored] }));
    assert.equal(rows()[0]?.[2], '6.8');
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
