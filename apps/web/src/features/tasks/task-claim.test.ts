import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { claimDetail } from '../../shared/claims/testing.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import type { TaskClaimRecord } from './client.ts';
import type { Mismatch } from './encounter-check.ts';
import { TaskClaimView } from './task-claim.tsx';

const CODES = {
  hcpcs: { A0427: 'ALS1 emergency' },
  modifier: { GY: 'Item or service excluded' },
  pos: { '41': 'Ambulance - Land' },
  icd10cm: { R079: 'Chest pain, unspecified' }
};

const RECORD: TaskClaimRecord = {
  claim: claimDetail,
  codes: CODES,
  issues: [],
  billing: { payer: 'Medicare', placeOfService: '41', modifiers: [['RH', 'GY']] }
};

const show = (
  patch: Partial<TaskClaimRecord> = {},
  mismatches?: Mismatch[],
  encounterHref?: string
) =>
  render(
    createElement(TaskClaimView, {
      record: { ...RECORD, ...patch },
      ...(mismatches ? { mismatches } : {}),
      encounterHref
    })
  );

const panel = (name: string) => screen.getByRole('region', { name });

const BLOCKING = {
  code: 'payer',
  field: 'payer' as const,
  message: 'No payer',
  coverageId: null,
  severity: 'blocking' as const
};

describe('TaskClaimView', () => {
  it('shows the whole claim in its panels', () => {
    show();
    assert.deepEqual(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ['Summary', 'Charges', 'Claim Data', 'Documentation', 'Payers']
    );
  });

  it('lists the charges with each code and modifier described, as billed to the payer', () => {
    show();
    const charges = panel('Charges');
    assert.ok(within(charges).getByText('Modifiers as billed to Medicare.'));
    const [, line] = within(charges).getAllByRole('row');
    assert.ok(line);
    const [code, modifiers] = within(line).getAllByRole('cell');
    assert.equal(code?.lastElementChild?.textContent, 'ALS1 emergency (A0427)');
    assert.deepEqual(
      within(modifiers as HTMLElement)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
      ['Residence to hospital (RH)', 'Item or service excluded (GY)']
    );
  });

  it('describes the place of service and diagnoses', () => {
    show();
    const data = panel('Claim Data');
    assert.ok(within(data).getByText('Ambulance - Land (41)'));
    assert.ok(within(data).getByText('Chest pain, unspecified (R07.9)'));
  });

  it('is read only', () => {
    show();
    assert.ok(!screen.queryByRole('button'));
  });

  it('leaves out modifiers and the payer note without billing', () => {
    show({ billing: null });
    const charges = panel('Charges');
    assert.ok(!within(charges).queryByText(/Modifiers as billed/));
    assert.ok(!within(charges).queryByRole('columnheader', { name: 'Modifiers' }));
    assert.ok(!within(panel('Claim Data')).queryByText('Ambulance - Land (41)'));
  });

  it('says when the claim has no charge lines yet', () => {
    show({ claim: { ...claimDetail, lines: [] } });
    const charges = panel('Charges');
    assert.ok(within(charges).getByText('No charge lines yet.'));
    assert.ok(!within(charges).queryByRole('table'));
  });

  it('shows what must be fixed on an open claim', () => {
    show({ issues: [BLOCKING] });
    assert.equal(screen.getByRole('alert').textContent, 'Must Be FixedPayer: No payer');
  });

  it('hides the issues of a closed claim', () => {
    show({ claim: { ...claimDetail, status: 'paid' }, issues: [BLOCKING] });
    assert.ok(!screen.queryByRole('alert'));
  });

  it('flags claim values that differ from the encounter', () => {
    show(
      {},
      [{ field: 'loadedMiles', label: 'Loaded Miles', encounter: '12.4' }],
      '/tasks/t1?tab=encounter'
    );
    const alert = screen.getByRole('status');
    assert.ok(within(alert).getByText(/1 value differs from the encounter: Loaded Miles\./));
    assert.equal(
      within(alert).getByRole('link', { name: 'Open Encounter' }).getAttribute('href'),
      '/tasks/t1?tab=encounter'
    );
  });
});
