import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { SettingsClient } from './client.ts';
import {
  FacilityForm,
  FacilityPage,
  fromHospital,
  hospitalLabel,
  toFacilityDraft
} from './facility-page.tsx';

describe('FacilityPage', () => {
  it('edits the name and mailing address of a facility on its own page', () => {
    const html = renderToStaticMarkup(
      createElement(FacilityForm, {
        facility: null,
        findHospitals: async () => [],
        back: '/facilities',
        onSave: async () => null
      })
    );
    for (const label of [
      'Fill From CMS Hospital',
      'Facility Name',
      'Street Address',
      'City',
      'State',
      'ZIP Code',
      'Phone',
      'Kind',
      'Contract',
      'Contract Note'
    ]) {
      assert.ok(html.includes(`>${label}<`), label);
    }
    assert.ok(html.includes('Save Facility') && html.includes('href="/facilities"'));
    assert.deepEqual(toFacilityDraft(null), {
      name: '',
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null,
      kind: 'other',
      contract: false,
      contractNote: null
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

  it('fills a new facility from a CMS hospital, keeping its contract terms', () => {
    const hospital = {
      ccn: '010001',
      name: 'SOUTHEAST HEALTH MEDICAL CENTER',
      address_line: '1108 ROSS CLARK CIRCLE',
      city: 'DOTHAN',
      state: 'AL',
      postal_code: '36301',
      phone: '3347938701',
      hospital_type: 'Acute Care Hospitals'
    };
    assert.equal(hospitalLabel(hospital), 'SOUTHEAST HEALTH MEDICAL CENTER, DOTHAN AL (010001)');
    const draft = { ...toFacilityDraft(null), contract: true, contractNote: 'Pays all 911' };
    assert.deepEqual(fromHospital(draft, hospital), {
      name: 'SOUTHEAST HEALTH MEDICAL CENTER',
      addressLine: '1108 ROSS CLARK CIRCLE',
      city: 'DOTHAN',
      state: 'AL',
      postalCode: '36301',
      phone: '3347938701',
      kind: 'hospital',
      contract: true,
      contractNote: 'Pays all 911'
    });
  });
});
