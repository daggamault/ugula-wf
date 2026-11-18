import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLEARINGHOUSE_VENDORS,
  FILE_EXTENSION_PATTERN,
  HOST_KEY_PATTERN,
  VENDOR_PRESETS,
  WAYSTAR_EXTENSIONS
} from './clearinghouse.ts';

describe('VENDOR_PRESETS', () => {
  it('follows Waystar for Waystar and the mock, and names every vendor', () => {
    assert.deepEqual(Object.keys(VENDOR_PRESETS), [...CLEARINGHOUSE_VENDORS]);
    assert.deepEqual(VENDOR_PRESETS.waystar.extensions, {
      claims: '.CLP',
      eligibility: '.ELG',
      claimStatus: '.CLS'
    });
    assert.equal(VENDOR_PRESETS.waystar.receiverId, 'WAYSTAR');
    assert.equal(VENDOR_PRESETS.mock.extensions, WAYSTAR_EXTENSIONS);
    assert.equal(VENDOR_PRESETS.mock.realtimeUrl, 'http://localhost:2224/core/realtime');
    assert.deepEqual(
      [VENDOR_PRESETS.waystar.hostKey, VENDOR_PRESETS['custom-sftp'].hostKey],
      [null, null]
    );
    assert.match(VENDOR_PRESETS.mock.hostKey ?? '', new RegExp(HOST_KEY_PATTERN));
    const pattern = new RegExp(FILE_EXTENSION_PATTERN);
    assert.deepEqual(
      Object.values(VENDOR_PRESETS).flatMap((p) =>
        Object.values(p.extensions).filter((e) => !pattern.test(e))
      ),
      []
    );
    assert.deepEqual(
      ['CLP', '.C.P', '.', '.CLP'].map((e) => pattern.test(e)),
      [false, false, false, true]
    );
  });
});
