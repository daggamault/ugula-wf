import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { searchStateOf } from '../../shared/url-state.ts';
import type { Payer, SettingsClient } from './client.ts';
import {
  LearnedNames,
  PayerForm,
  PayerPage,
  payerSavedNotice,
  toPayerDraft
} from './payer-page.tsx';
import { PAYER_TABLE, PayersPage, PayersTable } from './payers-page.tsx';
import { FILING_OPTIONS, fromProfileDraft, ProfileForm, toProfileDraft } from './settings-page.tsx';

const medicare: Payer = {
  id: 'p1',
  name: 'Medicare',
  payer_id: '00952',
  claim_filing: 'MB',
  aliases: [{ id: 'a1', alias: 'MCR Part B' }]
};

const pending = () => new Promise<never>(() => undefined);

describe('settings', () => {
  it('maps a saved profile into the form and starts empty without one', () => {
    assert.equal(toProfileDraft(null).npi, '');
    assert.equal(toProfileDraft(null).usage, 'T');
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
      production: true
    });
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
  });
});

describe('PayersPage', () => {
  it('searches payers and adds them on their own page', () => {
    const html = renderToStaticMarkup(
      createElement(PayersPage, { client: { searchPayers: pending } as unknown as SettingsClient })
    );
    assert.ok(html.includes('aria-label="Search Payers"'));
    assert.ok(html.includes('placeholder="Search Payers"'));
    assert.ok(html.includes('href="/payers/new"') && html.includes('Add Payer'));
  });

  it('lists payers with highlighted matches and links to their pages', () => {
    const html = renderToStaticMarkup(
      createElement(PayersTable, {
        payers: [medicare],
        search: searchStateOf('/payers', new URLSearchParams('q=part'), PAYER_TABLE),
        onDelete: () => undefined
      })
    );
    assert.ok(html.includes('Clearinghouse Payer ID'));
    assert.ok(html.includes('aria-label="Learned names for Medicare"'));
    assert.match(html, /MCR <mark[^>]*>Part<\/mark> B/);
    assert.ok(html.includes('href="/payers/p1?back=%2Fpayers%3Fq%3Dpart"'));
    assert.ok(html.includes('aria-label="Edit Medicare"'));
    assert.ok(html.includes('aria-label="Delete Medicare"'));
    assert.ok(html.includes('MB · Medicare Part B') && html.includes('00952'));
  });
});

describe('PayerPage', () => {
  it('edits a payer on a page with Title Cased labels that returns to the list', () => {
    const html = renderToStaticMarkup(
      createElement(PayerForm, {
        payer: medicare,
        back: '/payers?q=part',
        onSave: async () => null
      })
    );
    assert.ok(html.includes('>Payer Name<') && html.includes('>Clearinghouse Payer ID<'));
    assert.ok(html.includes('>Claim Filing<') && html.includes('readOnly=""'));
    assert.ok(html.includes('href="/payers?q=part"') && html.includes('>Save Payer<'));
    assert.deepEqual(toPayerDraft(null), { name: '', payerId: '', claimFiling: 'CI' });
  });

  it('lists learned names to forget, and a new payer starts with none', () => {
    const names = renderToStaticMarkup(
      createElement(LearnedNames, { payer: medicare, onForget: () => undefined })
    );
    assert.ok(names.includes('aria-label="Forget MCR Part B"'));
    const added = renderToStaticMarkup(
      createElement(PayerPage, {
        client: { payer: pending } as unknown as SettingsClient,
        payerId: null,
        back: '/payers'
      })
    );
    assert.ok(added.includes('>Add Payer</h1>') && !added.includes('Learned Names'));
    assert.ok(!added.includes('Delete Payer'));
  });

  it('says how many claims a saved payer was linked to', () => {
    assert.equal(payerSavedNotice('Medicare', 0), 'Medicare saved');
    assert.equal(payerSavedNotice('Medicare', 1), 'Medicare saved and linked to 1 claim');
    assert.equal(payerSavedNotice('Medicare', 3), 'Medicare saved and linked to 3 claims');
  });
});
