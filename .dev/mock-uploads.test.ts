import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isInboundUpload, routeUpload } from './mock-uploads.ts';

describe('isInboundUpload', () => {
  it('picks up finished files written straight into the upload folder', () => {
    assert.equal(isInboundUpload('/upload/B1.CLP'), true);
    assert.equal(isInboundUpload('/upload/B1.CLP.part'), false);
    assert.equal(isInboundUpload('/upload/B1.tmp'), false);
    assert.equal(isInboundUpload('/download/B1.CLP'), false);
    assert.equal(isInboundUpload('/upload/inner/B1.CLP'), false);
  });
});

describe('routeUpload', () => {
  it('routes each Waystar batch extension, in any case', () => {
    assert.deepEqual(routeUpload('B1.CLP'), { kind: 'claims' });
    assert.deepEqual(routeUpload('b1.elg'), { kind: 'eligibility' });
    assert.deepEqual(routeUpload('B1.CLS'), { kind: 'claimStatus' });
  });

  it('rejects extra periods and unknown extensions', () => {
    assert.deepEqual(routeUpload('B1.v2.CLP'), {
      error: 'file names may not contain extra periods'
    });
    assert.deepEqual(routeUpload('B1.txt'), {
      error: 'upload 837P files as .CLP, 270 as .ELG and 276 as .CLS'
    });
    assert.ok('error' in routeUpload('B1'));
  });
});
