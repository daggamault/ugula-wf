import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DOCUMENT_KINDS,
  documentContentTypeOf,
  isDocumentContentType,
  isDocumentKind
} from './claim-documents.ts';

describe('documents', () => {
  it('names the kinds of claim documents and the files they are stored as', () => {
    assert.equal(DOCUMENT_KINDS.abn, 'Advance Beneficiary Notice');
    assert.deepEqual(['pcs', 'msp', 'xray', null].map(isDocumentKind), [true, true, false, false]);
    assert.deepEqual(['application/pdf', 'image/jpeg', 'text/html'].map(isDocumentContentType), [
      true,
      true,
      false
    ]);
  });

  it('tells a document file type from its first bytes, whatever its name says', () => {
    const of = (...bytes: number[]) => documentContentTypeOf(Uint8Array.from(bytes));
    assert.equal(documentContentTypeOf(new TextEncoder().encode('%PDF-1.7')), 'application/pdf');
    assert.equal(of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'image/png');
    assert.equal(of(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg');
    assert.equal(of(0x49, 0x49, 0x2a, 0x00), 'image/tiff');
    assert.equal(of(0x4d, 0x4d, 0x00, 0x2a), 'image/tiff');
    assert.equal(documentContentTypeOf(new TextEncoder().encode('<html>')), null);
    assert.equal(of(), null);
  });
});
