import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Fee, FeesClient } from './client.ts';
import { FeesPage, FeesTable, toFeeInput } from './fees-page.tsx';

const fee = (over: Partial<Fee> = {}): Fee => ({
  id: 'f1',
  payer_id: null,
  payer: null,
  code: 'A0427',
  amount_cents: 95000,
  updated_at: '2026-10-01T00:00:00Z',
  ...over
});

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
  });
});

describe('FeesPage', () => {
  it('adds and edits fees in a dialog from the header', () => {
    const html = renderToStaticMarkup(
      createElement(FeesPage, {
        client: {
          list: () => new Promise(() => undefined),
          payers: () => new Promise(() => undefined)
        } as unknown as FeesClient
      })
    );
    assert.ok(html.includes('for="fee-payer"'));
    assert.ok(html.includes('for="fee-code"'));
    assert.ok(html.includes('step="0.01"'));
    assert.ok(html.includes('>Save fee<') && html.includes('Add fee'));
    assert.ok(html.includes('Default schedule (every payer)'));
  });

  it('lists default and payer prices with actions', () => {
    const html = renderToStaticMarkup(
      createElement(FeesTable, {
        fees: [fee(), fee({ id: 'f2', payer_id: 'p-m', payer: 'Medicare', amount_cents: 50000 })],
        onEdit: () => undefined,
        onDelete: () => undefined
      })
    );
    assert.ok(html.includes('>Default<'));
    assert.ok(html.includes('>Medicare<'));
    assert.ok(html.includes('$950.00'));
    assert.ok(html.includes('$500.00'));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
    assert.ok(html.includes('aria-label="Edit Default A0427"'));
    assert.ok(html.includes('aria-label="Delete Medicare A0427"'));
    assert.equal(html.match(/aria-label="Delete /g)?.length, 2);
    assert.ok(!html.includes('>Edit<') && !html.includes('>Delete<'));
  });
});
