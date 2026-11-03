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

describe('checks', () => {
  it('requires non-optional inputs and checks their type', () => {
    assert.equal(checkInput('Sum', { name: 'a', type: 'number' }, 2), 2);
    assert.equal(checkInput('Sum', { name: 'a', type: 'number', optional: true }, null), null);
    assert.throws(
      () => checkInput('Sum', { name: 'a', type: 'number', label: 'First' }, null),
      /Input "First" of "Sum" is required/
    );
    assert.throws(
      () => checkInput('Sum', { name: 'a', type: 'number' }, 'x'),
      /Input "a" of "Sum": expected number, got string/
    );
  });

  it('rejects unknown or mistyped outputs', () => {
    checkOutputs('Sum', sig, { total: 3 });
    assert.throws(() => checkOutputs('Sum', sig, { other: 1 }), /unknown output "other"/);
    assert.throws(() => checkOutputs('Sum', sig, { total: 1.5 }), /Output "total" of "Sum"/);
  });

  it('rejects exec outputs the signature does not declare', () => {
    checkExit('Sum', sig, { type: 'next', pin: 'then', outputs: {} });
    checkExit('Sum', sig, { type: 'next', pin: null, outputs: {} });
    assert.throws(
      () => checkExit('Sum', sig, { type: 'next', pin: 'else', outputs: {} }),
      /unknown exec output "else"/
    );
    checkExit('Sum', sig, {
      type: 'suspend',
      suspension: { kind: 'timer', data: null },
      state: null,
      outputs: {}
    });
  });
});
