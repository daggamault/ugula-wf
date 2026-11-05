import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOCUMENT_KINDS, isDocumentContentType, isDocumentKind } from './claim-documents.ts';

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
});
