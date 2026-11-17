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

  it('compares an input with another input', async () => {
    const config = {
      inputs: [
        { name: 'count', type: 'integer' },
        { name: 'shown', type: 'integer' },
        { name: 'code', type: 'string' },
        { name: 'allowed', type: { list: 'string' } }
      ],
      rules: [
        { field: 'count', op: 'gt', input: 'shown' },
        { field: 'code', op: 'oneOf', input: 'allowed' }
      ]
    };
    const both = await run(
      'std.logic.condition',
      { count: 5, shown: 3, code: 'A0427', allowed: ['A0427', 'A0429'] },
      config
    );
    assert.deepEqual(both.outputs, {
      result: true,
      reasons: ['Count is more than Shown', 'Code is one of Allowed']
    });
    const equal = await run('std.logic.condition', { count: 3, shown: 3, code: 'A0427' }, config);
    assert.deepEqual(equal.outputs, { result: false, reasons: [] });
    assert.equal((await run('std.logic.condition', { count: 5 }, config)).outputs.result, false);
    const same = { ...config, rules: [{ field: 'count', op: 'is', input: 'shown' }] };
    assert.equal((await run('std.flow.if', { count: 2, shown: 2 }, same)).pin, 'true');
    assert.equal((await run('std.flow.if', { count: 2 }, same)).pin, 'false');
    const def = conditionNodes.find((d) => d.type === 'std.logic.condition');
    assert.equal(
      def?.summary?.({ match: 'all', ...config }),
      'Count is more than Shown and Code is one of Allowed'
    );
  });

  it('rejects rules on inputs it does not have', async () => {
    await assert.rejects(
      () => run('std.logic.condition', {}, { rules: [{ field: 'x', op: 'present' }] }),
      /Each rule must test one of the inputs/
    );
    const inputs = [{ name: 'a', type: 'number' }];
    await assert.rejects(
      () =>
        run('std.logic.condition', {}, { inputs, rules: [{ field: 'a', op: 'gt', input: 'b' }] }),
      /Each rule must test one of the inputs/
    );
    for (const rule of [
      { field: 'a', op: 'gt', input: 'a', value: 1 },
      { field: 'a', op: 'empty', input: 'a' },
      { field: 'a', op: 'gt', input: 'a' }
    ]) {
      await assert.rejects(
        () => run('std.logic.condition', {}, { inputs, rules: [rule] }),
        /compares with a value or another input/
      );
    }
  });
});
