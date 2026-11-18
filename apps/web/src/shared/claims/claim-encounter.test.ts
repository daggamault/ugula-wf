import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { formatDateTime } from '../format.ts';
import { render, screen, within } from '../testing-dom.ts';
import { EncounterPanel, locationText } from './claim-encounter.tsx';
import { claimDetail } from './testing.ts';

const address = { line: null, city: null, county: null, state: null, postalCode: null };

describe('locationText', () => {
  it('names the place and writes its address, with state codes as USPS letters', () => {
    assert.equal(
      locationText({
        name: 'St. Mary',
        address: { ...address, line: '1 Main', city: 'Erie', state: '42', postalCode: '16505' }
      }),
      'St. Mary, 1 Main, Erie, PA 16505'
    );
    assert.equal(
      locationText({ name: null, address: { ...address, state: 'Nowhere' } }),
      'Nowhere'
    );
    assert.equal(locationText({ name: null, address }), null);
  });
});

const details = () =>
  within(screen.getByRole('region', { name: 'Encounter' }))
    .getAllByRole('term')
    .map((t) => [t.textContent, t.nextElementSibling?.textContent]);

describe('EncounterPanel', () => {
  it('shows the PCR, times, places, import and narrative of the encounter', () => {
    render(createElement(EncounterPanel, { claim: claimDetail }));
    assert.deepEqual(details(), [
      ['PCR', 'PCR-1001'],
      ['Encounter', '20261001-0007'],
      ['At Scene', formatDateTime('2026-10-01T10:05:00Z')],
      ['Left Scene', formatDateTime('2026-10-01T10:25:00Z')],
      ['At Destination', formatDateTime('2026-10-01T10:40:00Z')],
      ['Pickup', '9 Elm St, IL 62704'],
      ['Destination', 'St. Mary'],
      ['Imported From', 'october.xml']
    ]);
    assert.equal(
      screen.getByRole('link', { name: 'october.xml' }).getAttribute('href'),
      '/imports/i1'
    );
    assert.ok(screen.getByText('Pt found sitting.'));
  });

  it('marks a revised PCR and leaves out what the encounter lacks', () => {
    render(
      createElement(EncounterPanel, {
        claim: {
          ...claimDetail,
          encounter_revision: 2,
          import_id: null,
          encounter: { ...claimDetail.encounter, narrative: null }
        }
      })
    );
    const shown = Object.fromEntries(details());
    assert.equal(shown.PCR, 'PCR-1001 (revision 2)');
    assert.equal(shown['Imported From'], '—');
    assert.ok(!screen.queryByText(/Narrative/));
  });
});
