import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkExit, checkInput, checkOutputs } from './checks.ts';
import type { Signature } from './types.ts';

const sig: Signature = {
  execIn: ['exec'],
  execOut: ['then'],
  inputs: [],
  outputs: [{ name: 'total', type: 'integer' }]
};

describe('checkInput', () => {
  it('passes a value of the declared type through', () => {
    assert.equal(checkInput('Sum', { name: 'a', type: 'number' }, 2), 2);
  });

  it('passes a missing optional input through as null', () => {
    assert.equal(checkInput('Sum', { name: 'a', type: 'number', optional: true }, null), null);
  });

  it('requires a non-optional input, naming it by label when it has one', () => {
    assert.throws(() => checkInput('Sum', { name: 'a', type: 'number', label: 'First' }, null), {
      message: 'Input "First" of "Sum" is required'
    });
    assert.throws(() => checkInput('Sum', { name: 'a', type: 'number' }, null), {
      message: 'Input "a" of "Sum" is required'
    });
  });

  it('rejects a value of the wrong type', () => {
    assert.throws(() => checkInput('Sum', { name: 'a', type: 'number' }, 'x'), {
      message: 'Input "a" of "Sum": expected number, got string'
    });
  });

  it('checks the type of an optional input that is given', () => {
    assert.throws(() => checkInput('Sum', { name: 'a', type: 'number', optional: true }, 'x'), {
      message: 'Input "a" of "Sum": expected number, got string'
    });
  });
});

describe('checkOutputs', () => {
  it('accepts declared outputs of the declared type, or none', () => {
    assert.equal(checkOutputs('Sum', sig, { total: 3 }), undefined);
    assert.equal(checkOutputs('Sum', sig, {}), undefined);
  });

  it('rejects outputs the signature does not declare', () => {
    assert.throws(() => checkOutputs('Sum', sig, { other: 1 }), {
      message: '"Sum" produced unknown output "other"'
    });
  });

  it('rejects outputs of the wrong type', () => {
    assert.throws(() => checkOutputs('Sum', sig, { total: 1.5 }), {
      message: 'Output "total" of "Sum": expected integer, got number'
    });
  });
});

describe('checkExit', () => {
  it('accepts a declared exec output or none', () => {
    assert.equal(checkExit('Sum', sig, { type: 'next', pin: 'then', outputs: {} }), undefined);
    assert.equal(checkExit('Sum', sig, { type: 'next', pin: null, outputs: {} }), undefined);
  });

  it('rejects exec outputs the signature does not declare', () => {
    assert.throws(() => checkExit('Sum', sig, { type: 'next', pin: 'else', outputs: {} }), {
      message: '"Sum" fired unknown exec output "else"'
    });
    assert.throws(() => checkExit('Sum', sig, { type: 'call', pin: 'else', outputs: {} }), {
      message: '"Sum" fired unknown exec output "else"'
    });
  });

  it('lets a suspension through without a pin', () => {
    assert.equal(
      checkExit('Sum', sig, {
        type: 'suspend',
        suspension: { kind: 'timer', data: null },
        state: null,
        outputs: {}
      }),
      undefined
    );
  });
});
