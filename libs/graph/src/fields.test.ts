import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkField } from './fields.ts';

describe('checkField', () => {
  it('checks the value type and any allowed options', () => {
    const pin = {
      name: 'pin',
      type: 'string' as const,
      options: [
        { value: 'then', label: 'Then' },
        { value: 'failed', label: 'Failed' }
      ]
    };
    assert.equal(checkField(pin, 'then'), null);
    assert.equal(checkField(pin, null), null);
    assert.equal(checkField(pin, 'nope'), 'must be one of then, failed');
    assert.equal(checkField(pin, 3), 'expected string, got number');
    assert.equal(checkField({ name: 'n', type: 'number' }, 3), null);
  });
});
