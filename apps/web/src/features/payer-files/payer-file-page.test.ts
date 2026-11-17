import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen } from '../../shared/testing-dom.ts';
import type { PayerFileSummary, PayerFilesClient } from './client.ts';
import { PayerFileItems, PayerFilePage } from './payer-file-page.tsx';

describe('payer file page', () => {
  it('shows each line with its claim, outcome, amounts and why', () => {
    const html = renderToStaticMarkup(
      createElement(PayerFileItems, {
        items: [
          {
            position: 1,
            reference: '20261105-1001',
            claim_id: 'c1',
            claim_number: '20261105-1001',
            outcome: 'posted',
            message: '',
            paid_cents: 60_000,
            adjusted_cents: 25_000
          },
          {
            position: 2,
            reference: '9999',
            claim_id: null,
            claim_number: null,
            outcome: 'unmatched',
            message: 'No claim has number 9999',
            paid_cents: null,
            adjusted_cents: null
          }
        ]
      })
    );
    assert.ok(
      html.includes('>20261105-1001<') && html.includes('Posted') && html.includes('$600.00')
    );
    assert.ok(html.includes('No Match') && html.includes('No claim has number 9999'));
    assert.ok(html.includes('href="/claims/c1" aria-label="Open claim 20261105-1001"'));
    assert.equal(html.split('href="/claims/').length, 2);
    assert.ok(html.includes('>9999<') && html.includes('tabular-nums'));
    assert.ok(html.includes('>—<'));
  });
});

describe('PayerFilePage', () => {
  const file: PayerFileSummary = {
    id: 'f1',
    kind: '835',
    file_name: 'era.835',
    control_number: null,
    item_count: 0,
    problem_count: 0,
    created_at: '2026-10-31T12:00:00Z',
    uploaded_by: null
  };

  const show = (find: PayerFilesClient['find']) =>
    render(
      createElement(PayerFilePage, {
        client: {
          find,
          fileHref: (id: string) => `/api/payer-files/${id}/file`
        } as PayerFilesClient,
        live: idleLive,
        fileId: 'f1'
      })
    );

  it('offers the original file for download and says when nothing applied', async () => {
    show(async () => ({ file, items: [] }));
    assert.ok(await screen.findByRole('heading', { name: 'era.835' }));
    const download = screen.getByRole('link', { name: 'Download File' });
    assert.equal(download.getAttribute('href'), '/api/payer-files/f1/file');
    assert.equal(download.hasAttribute('download'), true);
    assert.ok(screen.getByText('Nothing to Apply'));
    assert.ok(screen.getByText('This file had nothing for your claims.'));
  });

  it('says why the file could not load', async () => {
    show(() => Promise.reject(new Error('Payer file not found')));
    assert.ok(await screen.findByText('Payer file not found'));
    assert.ok(!screen.queryByRole('link', { name: 'Download File' }));
  });
});
