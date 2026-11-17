import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import type { ClaimDocument } from '../../shared/claims/claim-detail.ts';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { render, screen, within } from '../../shared/testing-dom.ts';
import { DocumentsPanel, documentMeta } from './claim-documents.tsx';

const pcs: ClaimDocument = {
  id: 'd1',
  kind: 'pcs',
  file_name: 'pcs.pdf',
  signed_on: '2026-09-01',
  created_at: '2026-10-01T12:00:00Z',
  uploaded_by_email: 'dev@example.com'
};

const uploaded = `uploaded ${formatDateTime(pcs.created_at)}`;

const show = (documents: ClaimDocument[]) =>
  render(createElement(DocumentsPanel, { documents, documentUrl: (id: string) => `/files/${id}` }));

describe('documentMeta', () => {
  it('says when the document was signed, uploaded and by whom', () => {
    assert.equal(
      documentMeta(pcs),
      `signed ${formatDate('2026-09-01')} · ${uploaded} by dev@example.com`
    );
  });

  it('leaves out an unknown signing date and uploader', () => {
    assert.equal(documentMeta({ ...pcs, signed_on: null, uploaded_by_email: null }), uploaded);
  });
});

describe('DocumentsPanel', () => {
  it('lists each document by kind and name, to download', () => {
    show([pcs, { ...pcs, id: 'd2', file_name: 'later.pdf', signed_on: null }]);
    const panel = screen.getByRole('region', { name: 'Documents' });
    const items = within(panel).getAllByRole('listitem');
    assert.deepEqual(
      items.map((li) => li.textContent),
      [
        `Physician certification statement: pcs.pdf${documentMeta(pcs)}`,
        `Physician certification statement: later.pdf${uploaded} by dev@example.com`
      ]
    );
    const link = within(panel).getByRole('link', {
      name: 'Physician certification statement: pcs.pdf'
    });
    assert.equal(link.getAttribute('href'), '/files/d1');
    assert.equal(link.hasAttribute('download'), true);
  });

  it('only offers downloads, not uploads', () => {
    show([pcs]);
    assert.ok(!screen.queryByRole('button'));
    assert.ok(!document.querySelector('form'));
  });

  it('says when there are none', () => {
    show([]);
    const panel = screen.getByRole('region', { name: 'Documents' });
    assert.ok(!within(panel).queryByRole('list'));
    assert.ok(within(panel).getByText('No documents are on this claim yet.'));
  });
});
