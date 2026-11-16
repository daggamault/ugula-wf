import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { chooseNodes } from './choose.ts';

const [choose] = chooseNodes;

const run = async (inputs: Values, config: Json) => {
  if (!choose) throw new Error('missing');
  return invokeNode(choose, { inputs, config });
};

const BY_STATE = { mode: 'byCase', type: 'string', cases: [{ when: 'NH' }, { when: 'ME' }] };

describe('choose value', () => {
  it('picks the first filled-in option', async () => {
    assert.deepEqual((await run({ option1: null, option2: 'B' }, {})).outputs, { value: 'B' });
    assert.deepEqual((await run({ option1: '', option2: [], option3: 0 }, { count: 3 })).outputs, {
      value: 0
    });
    assert.deepEqual((await run({}, {})).outputs, { value: null });
  });

  it('exposes one pin per option', async () => {
    const { signature } = await run({}, { count: 3, type: 'number' });
    assert.deepEqual(
      signature.inputs.map((p) => p.name),
      ['option1', 'option2', 'option3']
    );
    assert.equal(signature.outputs[0]?.type, 'number');
  });

  it('picks the value for the matching case, or otherwise', async () => {
    const inputs = { case1: 'north', case2: 'east', otherwise: 'elsewhere' };
    assert.deepEqual((await run({ ...inputs, key: 'ME' }, BY_STATE)).outputs, { value: 'east' });
    assert.deepEqual((await run({ ...inputs, key: 'VT' }, BY_STATE)).outputs, {
      value: 'elsewhere'
    });
    assert.deepEqual((await run({ key: 'NH' }, BY_STATE)).outputs, { value: null });
    const { signature } = await run({}, BY_STATE);
    assert.deepEqual(
      signature.inputs.map((p) => [p.name, p.label]),
      [
        ['key', undefined],
        ['case1', 'When NH'],
        ['case2', 'When ME'],
        ['otherwise', undefined]
      ]
    );
  });

  it('rejects a case that appears twice', async () => {
    await assert.rejects(
      run({ key: 'NH' }, { mode: 'byCase', cases: [{ when: 'NH' }, { when: 'NH' }] }),
      /Each case can appear once/
    );
  });
});
