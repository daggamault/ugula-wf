import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invokeNode } from '../testing.ts';
import type { Json, Values } from '../types.ts';
import { conditionNodes } from './conditions.ts';

const CONFIG = {
  inputs: [
    { name: 'pickupState', type: 'string' },
    { name: 'emergency', type: 'boolean', label: 'Emergency Trip' }
  ],
  rules: [
    { field: 'pickupState', op: 'is', value: 'NH' },
    { field: 'emergency', op: 'is', value: true }
  ]
};

const run = async (type: string, inputs: Values, config: Json) => {
  const def = conditionNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

describe('condition nodes', () => {
  it('holds when all rules hold, with reasons', async () => {
    const all = await run('std.logic.condition', { pickupState: 'NH', emergency: true }, CONFIG);
    assert.deepEqual(all.outputs, {
      result: true,
      reasons: ['Pickup State is NH', 'Emergency Trip is true']
    });
    assert.deepEqual(
      all.signature.inputs.map((p) => p.name),
      ['pickupState', 'emergency']
    );
    const some = await run('std.logic.condition', { pickupState: 'NH', emergency: false }, CONFIG);
    assert.deepEqual(some.outputs, { result: false, reasons: ['Pickup State is NH'] });
    const any = await run(
      'std.logic.condition',
      { pickupState: 'NH', emergency: false },
      { ...CONFIG, match: 'any' }
    );
    assert.equal(any.outputs.result, true);
  });

  it('treats no rules as all holding, or none for any', async () => {
    assert.equal((await run('std.logic.condition', {}, {})).outputs.result, true);
    assert.equal((await run('std.logic.condition', {}, { match: 'any' })).outputs.result, false);
  });

  it('branches true or false', async () => {
    const yes = await run('std.flow.if', { pickupState: 'NH', emergency: true }, CONFIG);
    assert.equal(yes.pin, 'true');
    const no = await run('std.flow.if', { pickupState: 'ME' }, CONFIG);
    assert.equal(no.pin, 'false');
    assert.deepEqual(no.outputs, { reasons: [] });
  });

  it('summarizes the rules as a sentence', () => {
    const def = conditionNodes.find((d) => d.type === 'std.logic.condition');
    assert.equal(
      def?.summary?.({ match: 'all', ...CONFIG }),
      'Pickup State is NH and Emergency Trip is true'
    );
    assert.equal(
      def?.summary?.({
        match: 'any',
        inputs: CONFIG.inputs,
        rules: [
          { field: 'pickupState', op: 'oneOf', value: ['NH', 'ME'] },
          { field: 'pickupState', op: 'present' },
          { field: 'emergency', op: 'is', value: null }
        ]
      }),
      'Pickup State is one of NH, ME or Pickup State is filled in or Emergency Trip is empty'
    );
    assert.equal(def?.summary?.({ match: 'all', inputs: [], rules: [] }), null);
  });

  it('rejects rules on inputs it does not have', async () => {
    await assert.rejects(
      () => run('std.logic.condition', {}, { rules: [{ field: 'x', op: 'present' }] }),
      /Each rule must test one of the inputs/
    );
  });
});
