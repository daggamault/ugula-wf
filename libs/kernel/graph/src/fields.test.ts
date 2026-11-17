import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkField, isIsoDate } from './fields.ts';

const choice = {
  name: 'pin',
  type: 'string' as const,
  options: [
    { value: 'then', label: 'Then' },
    { value: 'failed', label: 'Failed' }
  ]
};

describe('isIsoDate', () => {
  it('accepts real calendar days, leap days included', () => {
    assert.equal(isIsoDate('2026-02-28'), true);
    assert.equal(isIsoDate('2028-02-29'), true);
  });

  it('rejects impossible days and other formats', () => {
    for (const bad of ['2026-02-30', '2026-02-29', '2026-13-01', '02/01/2026', '2026-2-1', '']) {
      assert.equal(isIsoDate(bad), false, bad);
    }
  });
});

describe('checkField', () => {
  it('checks the value type first', () => {
    assert.equal(checkField(choice, 3), 'expected string, got number');
    assert.equal(checkField({ name: 'n', type: 'number' }, 3), null);
  });

  it('accepts only the allowed options, comparing as text', () => {
    assert.equal(checkField(choice, 'then'), null);
    assert.equal(checkField(choice, 'nope'), 'must be one of then, failed');
    const code = { name: 'c', type: 'integer' as const, options: [{ value: '1', label: 'One' }] };
    assert.equal(checkField(code, 1), null);
    assert.equal(checkField(code, 2), 'must be one of 1');
  });

  it('lets an empty value through when nothing requires it', () => {
    assert.equal(checkField(choice, null), null);
  });

  it('requires a value only for the outcomes that need it', () => {
    const date = { name: 'd', type: 'string' as const, required: ['save'] };
    assert.equal(checkField(date, null, 'save'), 'is required');
    assert.equal(checkField(date, null, 'void'), null);
    assert.equal(checkField(date, null), null);
    assert.equal(checkField(date, 'x', 'save'), null);
  });

  it('counts blank text and empty lists as missing, but not zero', () => {
    assert.equal(
      checkField({ name: 'd', type: 'string', required: ['save'] }, '  ', 'save'),
      'is required'
    );
    assert.equal(
      checkField({ name: 'l', type: { list: 'string' }, required: ['save'] }, [], 'save'),
      'is required'
    );
    assert.equal(checkField({ name: 'n', type: 'number', required: ['save'] }, 0, 'save'), null);
  });

  it('checks dates are real calendar days, letting empty text through', () => {
    const date = { name: 'd', type: 'string' as const, format: 'date' as const };
    assert.equal(checkField(date, '2028-02-29'), null);
    assert.equal(checkField(date, '2026-02-30'), 'must be a date (YYYY-MM-DD)');
    assert.equal(checkField(date, '02/01/2026'), 'must be a date (YYYY-MM-DD)');
    assert.equal(checkField(date, ''), null);
  });

  it('checks numbers against an inclusive range', () => {
    const miles = { name: 'm', type: 'number' as const, min: 0.1, max: 500 };
    assert.equal(checkField(miles, 12.5), null);
    assert.equal(checkField(miles, 0.1), null);
    assert.equal(checkField(miles, 500), null);
    assert.equal(checkField(miles, 0), 'must be at least 0.1');
    assert.equal(checkField(miles, 900), 'must be at most 500');
  });

  it('checks a minimum or maximum alone', () => {
    assert.equal(checkField({ name: 'm', type: 'number', min: 1 }, 1_000_000), null);
    assert.equal(checkField({ name: 'm', type: 'number', max: 1 }, -5), null);
    assert.equal(checkField({ name: 'm', type: 'number', max: 1 }, 2), 'must be at most 1');
  });
});
