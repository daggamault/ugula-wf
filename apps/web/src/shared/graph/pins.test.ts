import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeType, pinKindOf, pinLabel, toneOf } from './pins.ts';

describe('pin tones', () => {
  it('classify value types and give each a distinct color', () => {
    assert.equal(pinKindOf('exec'), 'exec');
    assert.equal(pinKindOf({ list: 'number' }), 'list');
    assert.equal(pinKindOf({ object: {} }), 'object');
    assert.equal(pinKindOf({ id: 'claim' }), 'string');
    assert.ok(toneOf('number').dot === 'bg-pin-number');
    assert.ok(toneOf({ list: 'any' }).edge.includes('stroke-pin-list'));
    assert.notEqual(toneOf('string').dot, toneOf('integer').dot);
  });
});

const kinds = { id: { payerFile: 'Payer File ID' }, code: { hcpcs: 'HCPCS Code' } };

describe('describeType', () => {
  it('names value types in plain words', () => {
    assert.equal(describeType('integer', kinds), 'Whole Number');
    assert.equal(describeType({ list: 'string' }, kinds), 'List of Text');
    assert.equal(describeType({ list: { list: 'boolean' } }, kinds), 'List of List of Yes or No');
    assert.equal(
      describeType({ object: { bucket: 'string', key: 'string' } }, kinds),
      'Record With bucket, key'
    );
    assert.equal(describeType({ object: {} }, kinds), 'Record');
    assert.equal(describeType({ id: 'payerFile' }, kinds), 'Payer File ID');
    assert.equal(describeType({ list: { code: 'hcpcs' } }, kinds), 'List of HCPCS Code');
    assert.equal(describeType({ id: 'shift' }, kinds), 'Shift ID');
    assert.equal(describeType({ code: 'snomed' }, kinds), 'Snomed Code');
  });
});

describe('pinLabel', () => {
  it('title cases a given label and otherwise labels the pin from its name', () => {
    assert.equal(pinLabel({ name: 'x', label: 'Patient date of birth' }), 'Patient Date of Birth');
    assert.equal(pinLabel({ name: 'claimId' }), 'Claim ID');
    assert.equal(pinLabel({ name: 'pcrNumber', label: '' }), 'PCR Number');
  });
});
