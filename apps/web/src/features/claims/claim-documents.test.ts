import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentsPanel, documentMeta } from './claim-documents.tsx';

const pcs = {
  id: 'd1',
  kind: 'pcs' as const,
  file_name: 'pcs.pdf',
  signed_on: '2026-09-01',
  created_at: '2026-10-01T12:00:00Z',
  uploaded_by_email: 'dev@example.com'
};

const panel = (documents: (typeof pcs)[]) =>
  renderToStaticMarkup(
    createElement(DocumentsPanel, { documents, documentUrl: (id: string) => `/files/${id}` })
  );

describe('claim documents', () => {
  it('lists each document with its kind, signed date and who uploaded it, to download', () => {
    assert.match(documentMeta(pcs), /^signed .+ · uploaded .+ by dev@example\.com$/);
    assert.doesNotMatch(
      documentMeta({ ...pcs, signed_on: null, uploaded_by_email: null }),
      /signed|by/
    );
    const html = panel([pcs]);
    assert.ok(
      html.includes('href="/files/d1"') &&
        html.includes('Physician certification statement: pcs.pdf')
    );
    assert.ok(!html.includes('Upload Document') && !html.includes('<form'));
  });

  it('says when there are none', () => {
    assert.ok(panel([]).includes('No documents are on this claim yet.'));
  });
});
