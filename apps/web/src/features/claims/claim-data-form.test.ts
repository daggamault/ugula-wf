import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ClaimDataForm,
  DESTINATION_OPTIONS,
  fromDraft,
  ORIGIN_OPTIONS,
  toDraft
} from './claim-data-form.tsx';
import type { ClaimDetail } from './client.ts';

const claim = {
  id: 'c1',
  payers: ['Medicare', 'Blue Plan'],
  coverages: [{ payer: 'Medicare', payerCode: null, memberId: '1EG4', groupId: null }],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, addressLine: '9 Elm St', city: null, state: 'IL', postalCode: '62704' },
    destination: { name: 'St. Mary', addressLine: null, city: null, state: null, postalCode: null },
    diagnoses: ['R079', 'I10'],
    originDestination: 'SH'
  },
  address_line: '1 Main St',
  city: null,
  state: 'IL',
  postal_code: '62704'
} as unknown as ClaimDetail;

describe('claim data form', () => {
  it('round-trips claim data, blanks becoming missing values', () => {
    const draft = toDraft(claim);
    assert.deepEqual(draft.coverages, [
      { payer: 'Medicare', memberId: '1EG4', groupId: '' },
      { payer: 'Blue Plan', memberId: '', groupId: '' }
    ]);
    assert.equal(draft.diagnoses, 'R079, I10');
    const data = fromDraft({ ...draft, diagnoses: ' R07.9,I10  E11.9 ' });
    assert.deepEqual(data.diagnoses, ['R07.9', 'I10', 'E11.9']);
    assert.deepEqual(data.patient, {
      addressLine: '1 Main St',
      city: null,
      state: 'IL',
      postalCode: '62704'
    });
    assert.deepEqual(data.coverages[1], { payer: 'Blue Plan', memberId: null, groupId: null });
    assert.equal(data.destination.name, 'St. Mary');
    assert.equal(data.originDestination, 'SH');
    assert.deepEqual([draft.originCode, draft.destinationCode], ['S', 'H']);
    assert.equal(fromDraft({ ...draft, destinationCode: '' }).originDestination, null);
  });

  it('renders labelled inputs for every payer and location', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimDataForm, { claim, disabled: false, onSave: async () => true })
    );
    assert.ok(html.includes('for="coverage-1-memberId"'));
    assert.ok(html.includes('>Blue Plan<'));
    assert.ok(html.includes('for="destination-name"'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('>Save claim data<'));
    assert.ok(html.includes('for="origin-code"'));
    assert.ok(html.includes('S · Scene of an accident or acute event'));
    assert.equal(
      ORIGIN_OPTIONS.some((o) => o.value === 'X'),
      false
    );
    assert.equal(
      DESTINATION_OPTIONS.some((o) => o.value === 'X'),
      true
    );
  });
});
