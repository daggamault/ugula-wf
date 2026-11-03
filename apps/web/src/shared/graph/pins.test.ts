import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeType, pinKindOf, pinLabel, toneOf } from './pins.ts';

describe('pin tones', () => {
  it('classify value types and give each a distinct color', () => {
    assert.equal(pinKindOf('exec'), 'exec');
    assert.equal(pinKindOf({ list: 'number' }), 'list');
    assert.equal(pinKindOf({ object: {} }), 'object');
    assert.ok(toneOf('number').dot === 'bg-pin-number');
    assert.ok(toneOf({ list: 'any' }).edge.includes('stroke-pin-list'));
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

describe('pinLabel', () => {
  it('title cases a given label and otherwise labels the pin from its name', () => {
    assert.equal(pinLabel({ name: 'x', label: 'Patient date of birth' }), 'Patient Date of Birth');
    assert.equal(pinLabel({ name: 'claimId' }), 'Claim ID');
    assert.equal(pinLabel({ name: 'pcrNumber', label: '' }), 'PCR Number');
  });
});
