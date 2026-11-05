import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacilityPanel, facilityOptions, RecordsRequestPanel } from './claim-recovery.tsx';

const facilities = [{ id: 'f1', name: 'Sunrise SNF' }];

describe('claim recovery panels', () => {
  it('offers no facility first, then the current facility and the matching ones', () => {
    assert.deepEqual(facilityOptions(facilities, null), [
      { value: '', label: 'None: bill the payers and the patient' },
      { value: 'f1', label: 'Sunrise SNF' }
    ]);
    assert.deepEqual(
      facilityOptions(facilities, { id: 'f9', name: 'Oak Manor' }).map((o) => o.value),
      ['', 'f9', 'f1']
    );
    assert.equal(facilityOptions(facilities, facilities[0] ?? null).length, 2);
  });

  it('shows the responsible facility with a search for others and saves only a change', () => {
    const html = renderToStaticMarkup(
      createElement(FacilityPanel, {
        claim: { facility_id: 'f1', facility_name: 'Sunrise SNF' },
        findFacilities: async () => facilities,
        locked: undefined,
        onSave: async () => undefined
      })
    );
    assert.ok(html.includes('>Responsible Facility<') && html.includes('Save Facility'));
    assert.ok(html.includes('>Find Facility<') && html.includes('type="search"'));
    assert.match(html, /<option value="f1" selected="">Sunrise SNF<\/option>/);
    assert.ok(html.includes('Choose another facility first.'));
  });

  it('logs a records request with an optional due date, unless the claim is locked', () => {
    const open = renderToStaticMarkup(
      createElement(RecordsRequestPanel, { locked: undefined, onRequest: async () => true })
    );
    assert.ok(open.includes('>Records Request<') && open.includes('type="date"'));
    assert.ok(open.includes('Log Records Request'));
    const closed = renderToStaticMarkup(
      createElement(RecordsRequestPanel, {
        locked: 'This claim is closed.',
        onRequest: async () => true
      })
    );
    assert.ok(closed.includes('This claim is closed.') && closed.includes('disabled=""'));
  });
});
