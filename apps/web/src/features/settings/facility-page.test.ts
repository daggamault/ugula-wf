import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { SettingsClient } from './client.ts';
import { FacilityForm, FacilityPage, toFacilityDraft } from './facility-page.tsx';

describe('FacilityPage', () => {
  it('edits the name and mailing address of a facility on its own page', () => {
    const html = renderToStaticMarkup(
      createElement(FacilityForm, { facility: null, back: '/facilities', onSave: async () => null })
    );
    for (const label of ['Facility Name', 'Street Address', 'City', 'State', 'ZIP Code', 'Phone']) {
      assert.ok(html.includes(`>${label}<`), label);
    }
    assert.ok(html.includes('Save Facility') && html.includes('href="/facilities"'));
    assert.deepEqual(toFacilityDraft(null), {
      name: '',
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null
    });
    const page = renderToStaticMarkup(
      createElement(FacilityPage, {
        client: {} as SettingsClient,
        live: idleLive,
        facilityId: null,
        back: '/facilities'
      })
    );
    assert.ok(page.includes('Add Facility') && page.includes('Back to Facilities'));
  });
});
