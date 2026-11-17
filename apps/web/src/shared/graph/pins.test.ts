import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeType, pinKindOf, pinLabel, toneOf } from './pins.ts';

describe('pinKindOf', () => {
  it('keeps exec and plain value types as they are', () => {
    assert.equal(pinKindOf('exec'), 'exec');
    assert.equal(pinKindOf('datetime'), 'datetime');
  });

  it('treats IDs and codes as text', () => {
    assert.equal(pinKindOf({ id: 'claim' }), 'string');
    assert.equal(pinKindOf({ code: 'hcpcs' }), 'string');
  });

  it('tells lists from records', () => {
    assert.equal(pinKindOf({ list: 'number' }), 'list');
    assert.equal(pinKindOf({ object: {} }), 'object');
  });
});

describe('toneOf', () => {
  it('colors each kind of pin with its own token', () => {
    assert.deepEqual(toneOf('number'), {
      dot: 'bg-pin-number',
      edge: '[&_.react-flow__edge-path]:stroke-pin-number'
    });
    assert.deepEqual(toneOf({ list: 'any' }), {
      dot: 'bg-pin-list',
      edge: '[&_.react-flow__edge-path]:stroke-pin-list'
    });
    assert.equal(toneOf({ id: 'claim' }).dot, 'bg-pin-string');
  });

  it('draws exec wires thicker in the foreground color', () => {
    assert.deepEqual(toneOf('exec'), {
      dot: 'bg-surface-fg',
      edge: '[&_.react-flow__edge-path]:stroke-surface-fg [&_.react-flow__edge-path]:stroke-[3]'
    });
  });

  it('gives every kind a distinct dot', () => {
    const kinds = [
      'exec',
      'any',
      'string',
      'number',
      'integer',
      'boolean',
      'datetime',
      { list: 'any' },
      { object: {} }
    ] as const;
    assert.equal(new Set(kinds.map((k) => toneOf(k).dot)).size, kinds.length);
  });
});

const kinds = { id: { payerFile: 'Payer File ID' }, code: { hcpcs: 'HCPCS Code' } };

describe('describeType', () => {
  it('names plain value types in words', () => {
    assert.equal(describeType('any', kinds), 'Any Value');
    assert.equal(describeType('string', kinds), 'Text');
    assert.equal(describeType('integer', kinds), 'Whole Number');
    assert.equal(describeType('boolean', kinds), 'Yes or No');
    assert.equal(describeType('datetime', kinds), 'Date and Time');
  });

  it('names IDs and codes from the known kinds', () => {
    assert.equal(describeType({ id: 'payerFile' }, kinds), 'Payer File ID');
    assert.equal(describeType({ code: 'hcpcs' }, kinds), 'HCPCS Code');
  });

  it('labels unknown IDs and codes from their names', () => {
    assert.equal(describeType({ id: 'shift' }, kinds), 'Shift ID');
    assert.equal(describeType({ code: 'snomed' }, kinds), 'Snomed Code');
  });

  it('names lists by what they hold, however deep', () => {
    assert.equal(describeType({ list: 'string' }, kinds), 'List of Text');
    assert.equal(describeType({ list: { list: 'boolean' } }, kinds), 'List of List of Yes or No');
    assert.equal(describeType({ list: { code: 'hcpcs' } }, kinds), 'List of HCPCS Code');
  });

  it('names records by their fields', () => {
    assert.equal(
      describeType({ object: { bucket: 'string', key: 'string' } }, kinds),
      'Record With bucket, key'
    );
    assert.equal(describeType({ object: {} }, kinds), 'Record');
  });
});

describe('pinLabel', () => {
  it('title cases a given label', () => {
    assert.equal(pinLabel({ name: 'x', label: 'Patient date of birth' }), 'Patient Date of Birth');
  });

  it('labels the pin from its name without a label', () => {
    assert.equal(pinLabel({ name: 'claimId' }), 'Claim ID');
    assert.equal(pinLabel({ name: 'pcrNumber', label: '' }), 'PCR Number');
  });
});
