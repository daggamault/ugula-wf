import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import { render, screen } from '../../shared/testing-dom.ts';
import type { PayerFileDetail, PayerFilesClient } from './client.ts';
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
  const file: PayerFileDetail = {
    id: 'f1',
    kind: '835',
    file_name: 'era.835',
    control_number: null,
    item_count: 0,
    problem_count: 0,
    created_at: '2026-10-31T12:00:00Z',
    uploaded_by: null,
    payment_cents: null,
    payment_method: null,
    paid_on: null,
    trace_number: null,
    trace_payer_id: null,
    deposit_id: null
  };

  const paid: PayerFileDetail = {
    ...file,
    payment_cents: 60_000,
    payment_method: 'ACH',
    paid_on: '2026-10-30',
    trace_number: '1234567890',
    trace_payer_id: '1512345678',
    deposit_id: 'd1'
  };

  const detail = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

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

  it('shows the payment of an 835 and the deposit it matched', async () => {
    show(async () => ({ file: paid, items: [] }));
    assert.ok(await screen.findByRole('heading', { name: 'Payment' }));
    assert.equal(detail('Amount'), '$600.00');
    assert.equal(detail('Method'), 'Automated Clearing House (ACH) ACH');
    assert.equal(detail('Paid On'), 'Oct 30, 2026');
    assert.equal(detail('Trace Number'), '1234567890');
    assert.equal(detail('Payer ID'), '1512345678');
    assert.equal(
      screen.getByRole('link', { name: 'Open Deposit' }).getAttribute('href'),
      '/deposits/d1'
    );
  });

  it('says when an 835 payment has no deposit yet', async () => {
    show(async () => ({ file: { ...paid, deposit_id: null }, items: [] }));
    assert.ok(await screen.findByRole('heading', { name: 'Payment' }));
    assert.equal(detail('Deposit'), 'Not matched to a deposit');
    assert.equal(screen.queryByRole('link', { name: 'Open Deposit' }), null);
  });

  it('shows no payment for a file without a trace number', async () => {
    show(async () => ({ file, items: [] }));
    await screen.findByRole('heading', { name: 'era.835' });
    assert.equal(screen.queryByRole('heading', { name: 'Payment' }), null);
  });

  it('says why the file could not load', async () => {
    show(() => Promise.reject(new Error('Payer file not found')));
    assert.ok(await screen.findByText('Payer file not found'));
    assert.ok(!screen.queryByRole('link', { name: 'Download File' }));
  });
});
