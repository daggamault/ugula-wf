import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { SettingsClient } from './client.ts';
import {
  FILING_OPTIONS,
  fromProfileDraft,
  ProfileForm,
  SettingsPage,
  timeZoneOptions,
  toProfileDraft
} from './settings-page.tsx';

describe('settings', () => {
  it('maps a saved profile into the form and starts empty without one', () => {
    assert.equal(toProfileDraft(null).npi, '');
    assert.equal(toProfileDraft(null).usage, 'T');
    assert.equal(toProfileDraft(null, 'America/Denver').timeZone, 'America/Denver');
    const draft = toProfileDraft({
      organization_name: 'Acme',
      npi: '1234567893',
      tax_id: '123456789',
      address_line: '1 Rd',
      city: 'X',
      state: 'IL',
      postal_code: '62704',
      phone: '2175550100',
      submitter_id: 'SUB01',
      receiver_id: null,
      receiver_name: null,
      time_zone: 'America/Chicago',
      production: true
    });
    assert.equal(draft.timeZone, 'America/Chicago');
    assert.equal(draft.taxId, '123456789');
    assert.equal(draft.receiverId, '');
    const input = fromProfileDraft({ ...draft, receiverName: '  ' });
    assert.equal(input.submitterId, 'SUB01');
    assert.equal(input.receiverId, null);
    assert.equal(input.receiverName, null);
    assert.equal(input.production, true);
    assert.ok(!('usage' in input));
    assert.ok(FILING_OPTIONS.some((o) => o.value === 'MB' && o.label === 'MB · Medicare Part B'));
  });

  it('renders a labelled profile form', () => {
    const profile = renderToStaticMarkup(
      createElement(ProfileForm, { profile: null, onSave: async () => null })
    );
    assert.ok(profile.includes('for="profile-npi"'));
    assert.ok(profile.includes('>Save Profile<'));
    assert.ok(profile.includes('for="profile-submitterId"'));
    assert.ok(profile.includes('>Test Files<'));
    assert.ok(profile.includes('>Time Zone<') && profile.includes('pattern="\\d{5}-?\\d{4}"'));
    assert.ok(profile.includes('All 9 digits, like 62704-1234'));
    assert.ok(profile.includes('aria-label="Billing profile"'));
    assert.match(profile, /id="profile-npi"[^>]*required=""/);
    assert.doesNotMatch(profile, /id="profile-submitterId"[^>]*required=""/);
  });

  it('prefills a saved profile and selects production files', () => {
    const html = renderToStaticMarkup(
      createElement(ProfileForm, {
        profile: {
          organization_name: 'Acme EMS',
          npi: '1234567893',
          tax_id: '123456789',
          address_line: '1 Rd',
          city: 'Springfield',
          state: 'IL',
          postal_code: '627041234',
          phone: '2175550100',
          submitter_id: null,
          receiver_id: null,
          receiver_name: null,
          time_zone: 'America/Chicago',
          production: true
        },
        onSave: async () => null
      })
    );
    assert.ok(html.includes('value="Acme EMS"') && html.includes('value="627041234"'));
    assert.ok(html.includes('<option value="P" selected="">Production Files</option>'));
    assert.ok(
      html.includes('<option value="America/Chicago" selected="">America/Chicago</option>')
    );
  });
});

describe('timeZoneOptions', () => {
  it('lists IANA zones and keeps a saved zone the browser does not know', () => {
    assert.ok(timeZoneOptions('America/Chicago').some((o) => o.value === 'America/Chicago'));
    assert.equal(timeZoneOptions('Mars/Base')[0]?.value, 'Mars/Base');
    assert.ok(timeZoneOptions('America/New_York').some((o) => o.label === 'America/New York'));
  });

  it('shows one loading state until the profile and the connection are both loaded', () => {
    const pending = () => new Promise<never>(() => undefined);
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        live: idleLive,
        client: { profile: pending, connection: pending } as unknown as SettingsClient
      })
    );
    assert.equal(html.split('aria-label="Loading"').length - 1, 1);
    assert.ok(!html.includes('aria-label="Billing profile"'));
    assert.ok(!html.includes('aria-label="Clearinghouse connection"'));
  });
});
