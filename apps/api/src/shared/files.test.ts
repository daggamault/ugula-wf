import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeName, uploadKey } from './files.ts';

describe('uploaded file names', () => {
  it('keeps names safe for storage keys', () => {
    assert.equal(safeName('my report (1).xml'), 'my_report_1_.xml');
    assert.equal(safeName('../../etc/passwd'), 'etc_passwd');
    assert.equal(safeName('...'), 'upload');
  });

  it('stores uploads under the tenant import area in their own folder', () => {
    assert.match(uploadKey('t1', 'a b.xml'), /^imports\/t1\/[0-9a-f-]{36}\/a_b\.xml$/);
    assert.match(
      uploadKey('t1', 'a.xml', 'uploads/'),
      /^imports\/t1\/uploads\/[0-9a-f-]{36}\/a\.xml$/
    );
  });
});
