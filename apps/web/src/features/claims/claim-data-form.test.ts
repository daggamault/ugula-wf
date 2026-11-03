import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ClaimDataForm,
  DESTINATION_OPTIONS,
  fromDraft,
  modifierErrorOf,
  ORIGIN_OPTIONS,
  toDraft
} from './claim-data-form.tsx';
import type { ClaimDetail } from './client.ts';

const claim = {
  id: 'c1',
  coverages: [
    { id: 'cov-m', payer: 'Medicare', member_id: '1EG4', group_id: null },
    { id: 'cov-b', payer: 'Blue Plan', member_id: null, group_id: null }
  ],
  service_date: '2026-10-01',
  pickup_address_line: '9 Elm St',
  pickup_city: null,
  pickup_state: 'IL',
  pickup_postal_code: '62704',
  destination_name: 'St. Mary',
  destination_address_line: null,
  destination_city: null,
  destination_state: null,
  destination_postal_code: null,
  diagnoses: ['R079', 'I10'],
  origin_code: 'S',
  destination_code: 'H',
  address_line: '1 Main St',
  city: null,
  state: 'IL',
  postal_code: '62704',
  signature: 'missing',
  transport_reason: null,
  pcs_on_file: null,
  pcs_signed_on: null
} as unknown as ClaimDetail;

describe('claim data form', () => {
  it('sends only the documentation a biller changed', () => {
    const before = toDraft(claim);
    assert.equal(fromDraft(before, before).documentation, null);
    assert.deepEqual(
      fromDraft(
        {
          ...before,
          signature: 'signed',
          transportReason: 'D',
          pcsOnFile: 'yes',
          pcsSignedOn: '2026-09-20'
        },
        before
      ).documentation,
      { signature: 'signed', pcsOnFile: true, pcsSignedOn: '2026-09-20', transportReason: 'D' }
    );
    assert.deepEqual(fromDraft({ ...before, pcsOnFile: 'no' }, before).documentation, {
      signature: null,
      pcsOnFile: false,
      pcsSignedOn: null,
      transportReason: null
    });
  });

  it('round-trips claim data, blanks becoming missing values', () => {
    const draft = toDraft(claim);
    assert.deepEqual(draft.coverages, [
      { id: 'cov-m', payer: 'Medicare', memberId: '1EG4', groupId: '' },
      { id: 'cov-b', payer: 'Blue Plan', memberId: '', groupId: '' }
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
    assert.deepEqual(data.coverages[1], { id: 'cov-b', memberId: null, groupId: null });
    assert.equal(data.serviceDate, '2026-10-01');
    assert.equal(data.pickup.addressLine, '9 Elm St');
    assert.equal(data.destination.name, 'St. Mary');
    assert.equal(data.originDestination, 'SH');
    assert.deepEqual([draft.originCode, draft.destinationCode], ['S', 'H']);
    assert.equal(fromDraft({ ...draft, destinationCode: '' }).originDestination, null);
  });

  it('renders labelled inputs for every payer and location', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimDataForm, { claim, locked: undefined, onSave: async () => true })
    );
    assert.ok(html.includes('for="coverage-1-memberId"'));
    assert.ok(html.includes('>Blue Plan<'));
    assert.ok(html.includes('for="destination-name"'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('>Save Claim Data<'));
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
    assert.ok(html.includes('Diagnosis Codes (ICD-10-CM)') && html.includes('ZIP Code'));
    assert.ok(!html.includes('<fieldset disabled=""'));
  });

  it('disables every field and says why while the claim is locked', () => {
    const html = renderToStaticMarkup(
      createElement(ClaimDataForm, {
        claim,
        locked: 'This claim is closed.',
        onSave: async () => true
      })
    );
    assert.ok(html.includes('<fieldset disabled=""') && html.includes('This claim is closed.'));
  });

  it('ignores documentation values that are not a known code', () => {
    const before = toDraft(claim);
    assert.equal(
      fromDraft({ ...before, signature: 'bogus', transportReason: 'Z' }, before).documentation,
      null
    );
    assert.deepEqual(fromDraft({ ...before, pcsSignedOn: ' 2026-09-20 ' }, before).documentation, {
      signature: null,
      pcsOnFile: null,
      pcsSignedOn: '2026-09-20',
      transportReason: null
    });
  });
});

describe('modifierErrorOf', () => {
  it('needs both transport types or neither', () => {
    assert.equal(modifierErrorOf({ originCode: 'R', destinationCode: 'H' }), undefined);
    assert.equal(modifierErrorOf({ originCode: '', destinationCode: '' }), undefined);
    assert.match(modifierErrorOf({ originCode: 'R', destinationCode: '' }) ?? '', /both/);
  });
});
