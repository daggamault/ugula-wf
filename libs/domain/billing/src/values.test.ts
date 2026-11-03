import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCents, recordOf, requiredText, textOrNull } from './values.ts';

describe('values', () => {
  it('reads plain records and nothing else', () => {
    assert.deepEqual(recordOf({ a: 1 }), { a: 1 });
    assert.deepEqual(recordOf('x'), {});
    assert.deepEqual(recordOf([1]), {});
    assert.deepEqual(recordOf(null), {});
  });

  it('trims text and treats blanks and non-strings as missing', () => {
    assert.equal(textOrNull('  a '), 'a');
    assert.equal(textOrNull('   '), null);
    assert.equal(textOrNull(5), null);
  });

  it('accepts only whole, non-negative cents', () => {
    assert.equal(isCents(0), true);
    assert.equal(isCents(150), true);
    assert.equal(isCents(1.5), false);
    assert.equal(isCents(-1), false);
    assert.equal(isCents('1'), false);
  });

  it('returns trimmed required text or faults with the message', () => {
    assert.equal(requiredText(' c1 ', 'No claim'), 'c1');
    assert.throws(() => requiredText(' ', 'No claim'), /No claim/);
  });
});
