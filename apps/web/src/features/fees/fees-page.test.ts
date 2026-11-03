import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { Fee, FeesClient } from './client.ts';
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

describe('FeesPage', () => {
  it('searches fees and adds them on their own page', () => {
    const html = renderToStaticMarkup(
      createElement(FeesPage, {
        live: idleLive,
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
