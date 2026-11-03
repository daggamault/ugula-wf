import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { searchStateOf } from '../../shared/url-state.ts';
import type { Payer, SettingsClient } from './client.ts';
import { LearnedNames, PAYER_TABLE, PayersPage, PayersTable } from './payers-page.tsx';

const medicare: Payer = {
  id: 'p1',
  name: 'Medicare',
  payer_id: '00952',
  claim_filing: 'MB',
  aliases: [{ id: 'a1', alias: 'MCR Part B' }]
};

const pending = () => new Promise<never>(() => undefined);

describe('PayersPage', () => {
  it('searches payers and adds them on their own page', () => {
    const html = renderToStaticMarkup(
      createElement(PayersPage, {
        live: idleLive,
        client: { searchPayers: pending } as unknown as SettingsClient
      })
    );
    assert.ok(html.includes('aria-label="Search Payers"'));
    assert.ok(html.includes('placeholder="Search payers"'));
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

  it('shows learned names as badges', () => {
    const shown = renderToStaticMarkup(createElement(LearnedNames, { payer: medicare }));
    assert.ok(shown.includes('rounded-full') && shown.includes('MCR Part B'));
    const none = renderToStaticMarkup(
      createElement(LearnedNames, { payer: { ...medicare, aliases: [] } })
    );
    assert.equal(none, '');
  });
});
