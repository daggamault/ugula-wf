import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORM_OVERHEAD_BYTES, safeName, uploadKey } from './files.ts';

describe('safeName', () => {
  it('keeps letters, digits, dots, dashes and underscores', () => {
    assert.equal(safeName('run_2026-10.xml'), 'run_2026-10.xml');
  });

  it('collapses every other run of characters into one underscore', () => {
    assert.equal(safeName('my report (1).xml'), 'my_report_1_.xml');
  });

  it('drops leading dots and underscores so a name never climbs or hides', () => {
    assert.equal(safeName('../../etc/passwd'), 'etc_passwd');
    assert.equal(safeName('.env'), 'env');
  });

  it('keeps the last 120 characters so the extension survives', () => {
    const name = `${'a'.repeat(200)}.xml`;
    assert.equal(safeName(name), `${'a'.repeat(116)}.xml`);
  });

  it('names a file with nothing safe left upload', () => {
    assert.equal(safeName('...'), 'upload');
    assert.equal(safeName(''), 'upload');
  });
});

describe('uploadKey', () => {
  it('stores uploads under the agency import area in their own folder', () => {
    assert.match(uploadKey('t1', 'a b.xml'), /^imports\/t1\/[0-9a-f-]{36}\/a_b\.xml$/);
  });

  it('nests uploads in a subfolder when given one', () => {
    assert.match(
      uploadKey('t1', 'a.xml', 'uploads/'),
      /^imports\/t1\/uploads\/[0-9a-f-]{36}\/a\.xml$/
    );
  });

  it('gives every upload its own folder', () => {
    assert.notEqual(uploadKey('t1', 'a.xml'), uploadKey('t1', 'a.xml'));
  });
});

describe('FORM_OVERHEAD_BYTES', () => {
  it('allows 64 KiB of form framing on top of a file', () => {
    assert.equal(FORM_OVERHEAD_BYTES, 65_536);
  });
});
