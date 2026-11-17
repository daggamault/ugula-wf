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

const modifiersOf = (row: number) => {
  const cell = within(within(table()).getAllByRole('row')[row + 1] as HTMLElement).getAllByRole(
    'cell'
  )[1] as HTMLElement;
  return within(cell)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
};

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

  it('adds a modifiers column only when modifiers are given', () => {
    render(createElement(ChargeLines, { lines: [als], modifiers: [[]] }));
    assert.deepEqual(headers(), ['HCPCS', 'Modifiers', 'Units', 'Unit Price', 'Amount']);
    assert.deepEqual(rows(), [['A0427', '—', '1', '$800.00', '$800.00']]);
  });

  it('describes origin and destination modifiers and those the codes name, else shows them bare', () => {
    render(
      createElement(ChargeLines, {
        lines: [als],
        codes: { modifier: { GM: 'Multiple patients on one ambulance trip' } },
        modifiers: [['RH', 'GM', 'QM']]
      })
    );
    assert.deepEqual(modifiersOf(0), [
      'Residence to hospital RH',
      'Multiple patients on one ambulance trip GM',
      'QM'
    ]);
  });

  it('shows a dash for a line without modifiers or past the end of the modifier list', () => {
    render(createElement(ChargeLines, { lines: [als, mileage, als], modifiers: [['RH'], []] }));
    assert.deepEqual(
      rows().map((r) => r[1]),
      ['Residence to hospital RH', '—', '—']
    );
    assert.deepEqual(modifiersOf(1), []);
  });

  it('shows an empty table without lines', () => {
    render(createElement(ChargeLines, { lines: [] }));
    assert.deepEqual(rows(), []);
  });
});
