import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { searchStateOf } from '../../shared/url-state.ts';
import type { Fee, FeesClient } from './client.ts';
import { FeeForm, FeePage, toFeeDraft, toFeeInput } from './fee-page.tsx';
import { FEE_TABLE, FeesPage, FeesTable, feeName } from './fees-page.tsx';

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

const search = (query: string) => searchStateOf('/fees', new URLSearchParams(query), FEE_TABLE);

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
    assert.deepEqual(toFeeDraft(fee({ payer_id: 'p-m' })), {
      payerId: 'p-m',
      code: 'A0427',
      amount: '950.00'
    });
  });
});

describe('FeesPage', () => {
  it('searches fees and adds them on their own page', () => {
    const html = renderToStaticMarkup(
      createElement(FeesPage, {
        client: { search: pending } as unknown as FeesClient
      })
    );
    assert.ok(html.includes('aria-label="Search Fees"') && html.includes('>Search</label>'));
    assert.ok(html.includes('href="/fees/new"') && html.includes('Add Fee'));
    assert.ok(!html.includes('<dialog open'));
  });

  it('lists default and payer prices, highlights matches and links to their pages', () => {
    const html = renderToStaticMarkup(
      createElement(FeesTable, {
        fees: [fee(), fee({ id: 'f2', payer_id: 'p-m', payer: 'Medicare', amount_cents: 50000 })],
        search: search('q=a04&page=2'),
        onDelete: () => undefined
      })
    );
    assert.ok(html.includes('>Medicare<'));
    assert.ok(html.includes('$950.00') && html.includes('$500.00'));
    assert.match(html, /<mark[^>]*>A04<\/mark>27/);
    assert.ok(html.includes('href="/fees/f1?back=%2Ffees%3Fq%3Da04%26page%3D2"'));
    assert.ok(html.includes('aria-label="Edit Default A0427"'));
    assert.ok(html.includes('aria-label="Delete Medicare A0427"'));
    assert.ok(html.includes('>Edit</span>') && html.includes('>Delete</span>'));
    assert.equal(feeName(fee()), 'Default A0427');
  });
});

describe('FeePage', () => {
  it('adds a fee on a page with Title Cased labels that returns to the list', () => {
    const html = renderToStaticMarkup(
      createElement(FeeForm, {
        fee: null,
        payers: [],
        back: '/fees?q=a04',
        onSave: async () => null
      })
    );
    assert.ok(html.includes('for="fee-payer"') && html.includes('>Amount (USD)<'));
    assert.ok(html.includes('step="0.01"') && html.includes('Default Schedule (Every Payer)'));
    assert.ok(html.includes('href="/fees?q=a04"') && html.includes('>Save Fee<'));
    assert.ok(html.includes('@3xl:grid-cols-4'));
  });

  it('keeps the payer and code of an existing fee and loads it first', () => {
    const edit = renderToStaticMarkup(
      createElement(FeeForm, { fee: fee(), payers: [], back: '/fees', onSave: async () => null })
    );
    assert.ok(edit.includes('readOnly=""') && edit.includes('value="950.00"'));
    const loading = renderToStaticMarkup(
      createElement(FeePage, {
        client: { fee: pending, payers: pending } as unknown as FeesClient,
        feeId: 'f1',
        back: '/fees'
      })
    );
    assert.ok(loading.includes('aria-label="Back to Fees"') && loading.includes('href="/fees"'));
  });
});
