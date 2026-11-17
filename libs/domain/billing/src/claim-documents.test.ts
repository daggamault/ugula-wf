import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentContentTypeOf, isDocumentKind } from './claim-documents.ts';

describe('documents', () => {
  it('knows the kinds of claim documents', () => {
    assert.deepEqual(
      ['facesheet', 'pcs', 'signature', 'abn', 'msp', 'xray', 'toString', null].map(isDocumentKind),
      [true, true, true, true, true, false, false, false]
    );
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
    assert.equal(of(0x25, 0x50, 0x44, 0x46), null);
    assert.equal(of(0x49, 0x49, 0x00, 0x2a), null);
  });
});
