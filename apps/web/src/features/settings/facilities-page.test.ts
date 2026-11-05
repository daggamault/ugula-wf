import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { Facility, SettingsClient } from './client.ts';
import {
  FACILITY_TABLE,
  FacilitiesPage,
  FacilitiesTable,
  facilityDeleteNote,
  placeOf
} from './facilities-page.tsx';

const sunrise: Facility = {
  id: 'f1',
  name: 'Sunrise SNF',
  address_line: '5 Elm St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62702',
  phone: null,
  balance_cents: 125_000
};

const pending = () => new Promise<never>(() => undefined);

describe('FacilitiesPage', () => {
  it('searches facilities and adds them on their own page', () => {
    const html = renderToStaticMarkup(
      createElement(FacilitiesPage, {
        live: idleLive,
        client: { searchFacilities: pending } as unknown as SettingsClient
      })
    );
    assert.ok(html.includes('aria-label="Search Facilities"'));
    assert.ok(html.includes('href="/facilities/new"') && html.includes('Add Facility'));
  });

  it('lists facilities with what they owe and links to their pages', () => {
    const html = renderToStaticMarkup(
      createElement(FacilitiesTable, {
        facilities: [sunrise],
        search: searchStateOf('/facilities', new URLSearchParams('q=sun'), FACILITY_TABLE),
        onDelete: () => undefined
      })
    );
    assert.match(html, /<mark[^>]*>Sun<\/mark>rise SNF/);
    assert.ok(html.includes('$1,250.00'));
    assert.ok(html.includes('href="/facilities/f1?back=%2Ffacilities%3Fq%3Dsun"'));
    assert.ok(html.includes('aria-label="Delete Sunrise SNF"'));
    assert.equal(placeOf(sunrise), '5 Elm St · Springfield, IL');
    assert.match(facilityDeleteNote('Sunrise SNF'), /go back to their payers/);
  });
});
