import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { Fee, FeesClient } from './client.ts';
import { FeeForm, FeePage, payerOptions, toFeeDraft, toFeeInput } from './fee-page.tsx';

const fee = (over: Partial<Fee> = {}): Fee => ({
  id: 'f1',
  payer_id: null,
  payer: null,
  code: 'A0427',
  amount_cents: 95000,
  updated_at: '2026-10-01T00:00:00Z',
  ...over
});

const pending = () => new Promise<never>(() => undefined);

describe('toFeeInput', () => {
  it('converts the form into cents and an optional directory payer', () => {
    assert.deepEqual(toFeeInput({ payerId: '', code: ' a0427 ', amount: '950.5' }), {
      payerId: null,
      code: 'A0427',
      amountCents: 95050
    });
    assert.deepEqual(toFeeInput({ payerId: 'p-m', code: 'A0425', amount: '15.55' }), {
      payerId: 'p-m',
      code: 'A0425',
      amountCents: 1555
    });
    assert.equal(
      toFeeInput({ payerId: '', code: 'A0427', amount: '' }),
      'Enter an amount of zero or more.'
    );
    assert.equal(
      toFeeInput({ payerId: '', code: 'A0427', amount: '-1' }),
      'Enter an amount of zero or more.'
    );
    assert.equal(toFeeInput({ payerId: '', code: '  ', amount: '1' }), 'Enter a HCPCS code.');
    assert.deepEqual(toFeeDraft(fee({ payer_id: 'p-m' })), {
      payerId: 'p-m',
      code: 'A0427',
      amount: '950.00'
    });
    assert.equal(toFeeDraft(fee({ amount_cents: 1555 })).amount, '15.55');
    assert.deepEqual(toFeeDraft(null), { payerId: '', code: '', amount: '' });
  });
});

describe('payerOptions', () => {
  it('offers the default schedule, the chosen payer and the matches once each', () => {
    const medicare = { id: 'p-m', name: 'Medicare' };
    const aetna = { id: 'p-a', name: 'Aetna' };
    assert.deepEqual(
      payerOptions([aetna], medicare).map((o) => o.value),
      ['', 'p-m', 'p-a']
    );
    assert.deepEqual(
      payerOptions([medicare], medicare).map((o) => o.label),
      ['Default Schedule (Every Payer)', 'Medicare']
    );
  });
});

describe('FeePage', () => {
  it('adds a fee on a page with Title Cased labels that returns to the list', () => {
    const html = renderToStaticMarkup(
      createElement(FeeForm, {
        fee: null,
        findPayers: pending,
        back: '/fees?q=a04',
        onSave: async () => null
      })
    );
    assert.ok(html.includes('for="fee-payer"') && html.includes('>Amount (USD)<'));
    assert.ok(html.includes('step="0.01"') && html.includes('Default Schedule (Every Payer)'));
    assert.ok(html.includes('href="/fees?q=a04"') && html.includes('>Save Fee<'));
    assert.ok(html.includes('@3xl:grid-cols-4'));
    assert.ok(html.includes('>Find Payer<') && html.includes('type="search"'));
  });

  it('keeps the payer and code of an existing fee and loads it first', () => {
    const edit = renderToStaticMarkup(
      createElement(FeeForm, {
        fee: fee(),
        findPayers: pending,
        back: '/fees',
        onSave: async () => null
      })
    );
    assert.ok(edit.includes('readOnly=""') && edit.includes('value="950.00"'));
    assert.ok(
      edit.includes('value="Default Schedule (Every Payer)"') && !edit.includes('Find Payer')
    );
    const loading = renderToStaticMarkup(
      createElement(FeePage, {
        live: idleLive,
        client: { fee: pending, payers: pending } as unknown as FeesClient,
        feeId: 'f1',
        back: '/fees'
      })
    );
    assert.ok(loading.includes('aria-label="Back to Fees"') && loading.includes('href="/fees"'));
  });

  it('adds a new fee without loading one or offering to delete it', () => {
    const html = renderToStaticMarkup(
      createElement(FeePage, {
        live: idleLive,
        client: { fee: pending, payers: pending } as unknown as FeesClient,
        feeId: null,
        back: '/fees'
      })
    );
    assert.ok(html.includes('>Add Fee<') && html.includes('>Save Fee<'));
    assert.ok(!html.includes('Delete Fee') && !html.includes('aria-label="Loading"'));
  });
});
