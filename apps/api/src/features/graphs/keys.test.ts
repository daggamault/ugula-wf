import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { customKey } from './keys.ts';

describe('customKey', () => {
  it('makes an opaque dotted key that starts with a letter', () => {
    assert.match(customKey(), /^custom\.[a-z][a-z0-9]{9}$/);
    assert.equal(
      customKey(() => 0),
      'custom.aaaaaaaaaa'
    );
  });

  it('makes a different key each time', () => {
    assert.notEqual(customKey(), customKey());
  });
});
