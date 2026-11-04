import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { idleLive } from '../../shared/testing.ts';
import type { PayerFilesClient } from './client.ts';
import { PayerFilesPage, PayerFilesTable } from './payer-files-page.tsx';

describe('payer files page', () => {
  it('lists each file with its kind, lines and outcome', () => {
    const html = renderToStaticMarkup(
      createElement(PayerFilesTable, {
        files: [
          {
            id: 'f1',
            kind: '835',
            file_name: 'era.835',
            control_number: '101',
            item_count: 4,
            problem_count: 1,
            created_at: '2026-10-31T12:00:00Z',
            uploaded_by: 'biller@agency.test'
          }
        ]
      })
    );
    assert.ok(html.includes('era.835') && html.includes('Remittance (835)'));
    assert.ok(html.includes('1 of 4 needs you'));
    assert.ok(html.includes('href="/payer-files/f1" aria-label="Open payer file era.835"'));
    assert.ok(html.includes('<span class="sr-only">Actions</span>'));
  });

  it('explains what the page is for', () => {
    const client = { list: () => new Promise(() => undefined) } as unknown as PayerFilesClient;
    const html = renderToStaticMarkup(createElement(PayerFilesPage, { client, live: idleLive }));
    assert.ok(html.includes('Payer Files') && html.includes('clearinghouse'));
    assert.ok(html.includes('Upload Payer Files') && html.includes('type="file"'));
    assert.ok(html.includes('multiple'));
  });
});
