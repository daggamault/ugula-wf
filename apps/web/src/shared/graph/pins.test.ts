import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeType, pinKindOf, toneOf } from './pins.ts';

describe('pin tones', () => {
  it('classify value types and give each a distinct color', () => {
    assert.equal(pinKindOf('exec'), 'exec');
    assert.equal(pinKindOf({ list: 'number' }), 'list');
    assert.equal(pinKindOf({ object: {} }), 'object');
    assert.ok(toneOf('number').dot.includes('emerald'));
    assert.ok(toneOf({ list: 'any' }).edge.includes('stroke-sky-500'));
    assert.notEqual(toneOf('string').dot, toneOf('integer').dot);
  });
});

describe('describeType', () => {
  it('names value types in plain words', () => {
    assert.equal(describeType('integer'), 'Whole Number');
    assert.equal(describeType({ list: 'string' }), 'List of Text');
    assert.equal(describeType({ list: { list: 'boolean' } }), 'List of List of Yes or No');
    assert.equal(
      describeType({ object: { bucket: 'string', key: 'string' } }),
      'Record With bucket, key'
    );
    assert.equal(describeType({ object: {} }), 'Record');
  });
});
