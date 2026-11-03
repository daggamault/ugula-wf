import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { Payer, SettingsClient } from './client.ts';
import {
  LearnedNamesPanel,
  PayerForm,
  PayerPage,
  payerSavedNotice,
  toPayerDraft
} from './payer-page.tsx';

const medicare: Payer = {
  id: 'p1',
  name: 'Medicare',
  payer_id: '00952',
  claim_filing: 'MB',
  filing_limit_days: null,
  aliases: [{ id: 'a1', alias: 'MCR Part B' }]
};

const pending = () => new Promise<never>(() => undefined);

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
    assert.ok(html.includes('for="payer-filing-limit"') && html.includes('>Filing Limit (Days)<'));
    assert.ok(
      html.includes('type="number"') && html.includes('min="1"') && html.includes('max="3650"')
    );
    assert.ok(html.includes('To rename a payer, add it again under the new name.'));
    assert.deepEqual(toPayerDraft(null), {
      name: '',
      payerId: '',
      claimFiling: 'CI',
      filingLimitDays: null
    });
    assert.deepEqual(toPayerDraft({ ...medicare, filing_limit_days: 365 }), {
      name: 'Medicare',
      payerId: '00952',
      claimFiling: 'MB',
      filingLimitDays: 365
    });
    const added = renderToStaticMarkup(
      createElement(PayerForm, { payer: null, back: '/payers', onSave: async () => null })
    );
    assert.ok(!added.includes('readOnly=""') && !added.includes('To rename a payer'));
  });

  it('adds a new payer without learned names or a delete action', () => {
    const added = renderToStaticMarkup(
      createElement(PayerPage, {
        live: idleLive,
        client: { payer: pending } as unknown as SettingsClient,
        payerId: null,
        back: '/payers'
      })
    );
    assert.ok(added.includes('>Add Payer</h1>') && !added.includes('Learned Names'));
    assert.ok(!added.includes('Delete Payer'));
  });

  it('lists learned names in a table with a delete action each', () => {
    const html = renderToStaticMarkup(
      createElement(LearnedNamesPanel, { payer: medicare, onForget: () => undefined })
    );
    assert.ok(html.includes('<table aria-label="Learned names for Medicare"'));
    assert.ok(html.includes('aria-label="Delete MCR Part B"'));
    const none = renderToStaticMarkup(
      createElement(LearnedNamesPanel, {
        payer: { ...medicare, aliases: [] },
        onForget: () => undefined
      })
    );
    assert.ok(none.includes('No learned names yet'));
  });

  it('says how many claims a saved payer was linked to', () => {
    assert.equal(payerSavedNotice('Medicare', 0), 'Medicare saved');
    assert.equal(payerSavedNotice('Medicare', 1), 'Medicare saved and linked to 1 claim');
    assert.equal(payerSavedNotice('Medicare', 3), 'Medicare saved and linked to 3 claims');
  });
});
