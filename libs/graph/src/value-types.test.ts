import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ValueType } from './types.ts';
import { checkValue, formatType, isAssignable, parseType } from './value-types.ts';

describe('value types', () => {
  it('formats nested types', () => {
    assert.equal(
      formatType({ list: { object: { code: 'string' } } }),
      'list<object{code: string}>'
    );
  });

  it('parses the formatted notation back into types', () => {
    for (const type of [
      'number',
      { list: 'string' },
      { object: {} },
      { list: { object: { code: 'string', units: { list: 'integer' } } } }
    ] as const) {
      assert.deepEqual(parseType(formatType(type)), type);
    }
    assert.deepEqual(parseType(' list< number > '), { list: 'number' });
    assert.throws(() => parseType('money'), /Unknown type "money"/);
    assert.throws(() => parseType('list<number'), /Expected ">"/);
    assert.throws(() => parseType('number>'), /Unexpected/);
  });

  it('decides pin compatibility', () => {
    assert.equal(isAssignable('any', 'number'), true);
    assert.equal(isAssignable('integer', 'number'), true);
    assert.equal(isAssignable('datetime', 'string'), true);
    assert.equal(isAssignable('string', 'number'), false);
    assert.equal(isAssignable({ list: 'integer' }, { list: 'number' }), true);
    assert.equal(isAssignable({ list: 'string' }, 'string'), false);
    assert.equal(isAssignable({ object: {} }, { object: { id: 'string' } }), true);
    assert.equal(isAssignable({ object: { id: 'number' } }, { object: { id: 'string' } }), false);
  });

  it('checks runtime values with paths in messages', () => {
    assert.equal(checkValue('number', null), null);
    assert.equal(checkValue('integer', 1.5), 'expected integer, got number');
    assert.equal(checkValue('datetime', '2026-01-01'), null);
    assert.equal(checkValue('datetime', 'soon'), 'expected datetime, got string');
    assert.equal(checkValue({ list: 'number' }, [1, 'x']), '[1]: expected number, got string');
    assert.equal(
      checkValue({ object: { id: 'string' } }, { id: 3 }),
      'id: expected string, got number'
    );
    assert.equal(checkValue('boolean', 'true'), 'expected boolean, got string');
  });

  it('rejects values that would change when saved as JSON', () => {
    assert.equal(checkValue('any', Number.NaN), 'not a finite number');
    assert.equal(
      checkValue('any', { a: [1, Number.POSITIVE_INFINITY] }),
      'a: [1]: not a finite number'
    );
    assert.equal(checkValue({ object: {} }, { extra: Number.NaN }), 'extra: not a finite number');
    const inherited = JSON.parse('{"object":{"toString":"string"}}') as ValueType;
    assert.equal(checkValue(inherited, {}), null);
  });
});
