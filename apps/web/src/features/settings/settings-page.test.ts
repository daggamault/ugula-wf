import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { matchesPayer, PayerDirectory, payerSavedNotice } from './payers-page.tsx';
import { FILING_OPTIONS, fromProfileDraft, ProfileForm, toProfileDraft } from './settings-page.tsx';

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

  it('renders labelled profile and payer forms', () => {
    const profile = renderToStaticMarkup(
      createElement(ProfileForm, { profile: null, onSave: async () => null })
    );
    assert.ok(profile.includes('for="profile-npi"'));
    assert.ok(profile.includes('>Save profile<'));
    assert.ok(profile.includes('for="profile-submitterId"'));
    assert.ok(profile.includes('>Test files<'));
    const payers = renderToStaticMarkup(
      createElement(PayerDirectory, {
        payers: [
          {
            id: 'p1',
            name: 'Medicare',
            payer_id: '00952',
            claim_filing: 'MB',
            aliases: [{ id: 'a1', alias: 'MCR Part B' }]
          }
        ],
        isSearching: false,
        onSave: async () => null,
        onDelete: () => undefined,
        onForget: () => undefined,
        open: false,
        onOpen: () => undefined,
        onClose: () => undefined
      })
    );
    assert.ok(payers.includes('>Medicare<'));
    assert.ok(payers.includes('aria-label="Learned names for Medicare"'));
    assert.ok(payers.includes('aria-label="Forget MCR Part B for Medicare"'));
    assert.ok(payers.includes('cursor-pointer'));
    assert.ok(payers.includes('<span class="sr-only">Actions</span>'));
    assert.ok(payers.includes('aria-label="Edit Medicare"'));
    assert.ok(payers.includes('aria-label="Delete Medicare"'));
    assert.ok(!payers.includes('>Edit<'));
    assert.ok(payers.includes('00952'));
    assert.ok(payers.includes('MB · Medicare Part B'));
    const none = renderToStaticMarkup(
      createElement(PayerDirectory, {
        payers: [],
        isSearching: false,
        onSave: async () => null,
        onDelete: () => undefined,
        onForget: () => undefined,
        open: false,
        onOpen: () => undefined,
        onClose: () => undefined
      })
    );
    assert.ok(none.includes('No Payers Yet'));
    assert.ok(payers.includes('for="payer-name"') && payers.includes('>Save payer<'));
  });
});

describe('payerSavedNotice', () => {
  it('says how many claims a saved payer was linked to', () => {
    assert.equal(payerSavedNotice('Medicare', 0), 'Medicare saved');
    assert.equal(payerSavedNotice('Medicare', 1), 'Medicare saved and linked to 1 claim');
    assert.equal(payerSavedNotice('Medicare', 3), 'Medicare saved and linked to 3 claims');
  });
});

describe('matchesPayer', () => {
  it('finds payers by name or payer ID, ignoring case', () => {
    const payer = {
      id: 'p1',
      name: 'Medicare',
      payer_id: '00952',
      claim_filing: 'MB',
      aliases: []
    };
    assert.equal(matchesPayer(payer, ''), true);
    assert.equal(matchesPayer(payer, 'medi'), true);
    assert.equal(matchesPayer(payer, '0095'), true);
    assert.equal(matchesPayer(payer, 'aetna'), false);
  });
});
