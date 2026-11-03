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
    const code = { name: 'c', type: 'integer' as const, options: [{ value: '1', label: 'One' }] };
    assert.equal(checkField(code, 1), null);
    assert.equal(checkField(code, 2), 'must be one of 1');
  });

  it('requires a value only for the outcomes that need it', () => {
    const date = { name: 'd', type: 'string' as const, required: ['save'] };
    assert.equal(checkField(date, null, 'save'), 'is required');
    assert.equal(checkField(date, '  ', 'save'), 'is required');
    assert.equal(checkField(date, null, 'void'), null);
    assert.equal(checkField(date, null), null);
    assert.equal(checkField(date, 'x', 'save'), null);
    assert.equal(checkField({ name: 'n', type: 'number', required: ['save'] }, 0, 'save'), null);
    assert.equal(
      checkField({ name: 'l', type: { list: 'string' }, required: ['save'] }, [], 'save'),
      'is required'
    );
  });

  it('checks calendar dates and number ranges', () => {
    const date = { name: 'd', type: 'string' as const, format: 'date' as const };
    assert.equal(checkField(date, '2026-02-28'), null);
    assert.equal(checkField(date, '2026-02-30'), 'must be a date (YYYY-MM-DD)');
    assert.equal(checkField(date, '02/01/2026'), 'must be a date (YYYY-MM-DD)');
    assert.equal(checkField(date, '2028-02-29'), null);
    assert.equal(checkField(date, ''), null);
    const miles = { name: 'm', type: 'number' as const, min: 0.1, max: 500 };
    assert.equal(checkField(miles, 12.5), null);
    assert.equal(checkField(miles, 0), 'must be at least 0.1');
    assert.equal(checkField(miles, 900), 'must be at most 500');
    assert.equal(checkField(miles, 0.1), null);
    assert.equal(checkField(miles, 500), null);
  });
});
