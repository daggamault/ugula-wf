import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRegistry } from '../registry.ts';
import { invokeNode } from '../testing.ts';
import type { GraphDef, Json, Values, ValueType } from '../types.ts';
import { validateGraph } from '../validate.ts';
import { fieldNodes } from './fields.ts';

const FACTS: ValueType = {
  object: { pickupState: 'string', trip: { object: { miles: 'number' } } }
};

const run = async (type: string, inputs: Values, config: Json) => {
  const def = fieldNodes.find((d) => d.type === type);
  if (!def) throw new Error(type);
  return invokeNode(def, { inputs, config });
};

describe('field nodes', () => {
  it('reads a field typed from the record', async () => {
    const got = await run(
      'std.object.get-field',
      { record: { pickupState: 'NH', trip: { miles: 4 } } },
      { record: FACTS, path: 'trip.miles' }
    );
    assert.deepEqual(got.outputs, { value: 4 });
    assert.deepEqual(got.signature.outputs[0], {
      name: 'value',
      type: 'number',
      label: 'Trip › Miles',
      description: 'The value of the field, or nothing when it is empty.'
    });
    assert.deepEqual(
      (await run('std.object.get-field', {}, { record: FACTS, path: 'pickupState' })).outputs,
      { value: null }
    );
  });

  it('sets a field on a copy of the record', async () => {
    const record = { pickupState: 'NH', trip: { miles: 4 } };
    const set = await run(
      'std.object.set-field',
      { record, value: 'ME' },
      { record: FACTS, path: 'pickupState' }
    );
    assert.deepEqual(set.outputs, { record: { pickupState: 'ME', trip: { miles: 4 } } });
    assert.equal(record.pickupState, 'NH');
    assert.deepEqual(
      set.signature.inputs.map((p) => [p.name, p.type]),
      [
        ['record', FACTS],
        ['value', 'string']
      ]
    );
  });

  it('reads and writes any path of an untyped record', async () => {
    const got = await run('std.object.get-field', { record: { a: { b: 2 } } }, { path: 'a.b' });
    assert.deepEqual(got.outputs, { value: 2 });
    assert.equal(got.signature.outputs[0]?.type, 'any');
    const set = await run('std.object.set-field', { value: 3 }, { path: 'a.b' });
    assert.deepEqual(set.outputs, { record: { a: { b: 3 } } });
  });

  it('gives no value pin until a field is chosen, and passes the record through', async () => {
    const unchosen = await run('std.object.get-field', { record: { a: 1 } }, { record: FACTS });
    assert.deepEqual([unchosen.signature.outputs, unchosen.outputs], [[], {}]);
    const passed = await run('std.object.set-field', { record: { a: 1 } }, {});
    assert.deepEqual(
      passed.signature.inputs.map((p) => p.name),
      ['record']
    );
    assert.deepEqual(passed.outputs, { record: { a: 1 } });
    assert.deepEqual((await run('std.object.set-field', {}, {})).outputs, { record: null });
  });

  it('summarizes the field in words', () => {
    for (const def of fieldNodes) {
      assert.equal(def.summary?.({ record: FACTS, path: 'pickupState' }), 'Pickup State');
      assert.equal(def.summary?.({ record: FACTS, path: '' }), 'Choose a field');
    }
  });

  it('rejects a path the record type does not have', async () => {
    await assert.rejects(
      () => run('std.object.get-field', {}, { record: FACTS, path: 'dropoffState' }),
      /no field "dropoffState"/
    );
    const def: GraphDef = {
      signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
      variables: [],
      nodes: [
        {
          id: 'get',
          type: 'std.object.get-field',
          version: 1,
          config: { record: FACTS, path: 'trip.speed' }
        }
      ],
      edges: []
    };
    assert.deepEqual(
      validateGraph(
        def,
        createRegistry(fieldNodes, () => undefined)
      ),
      [
        { message: 'A pure graph needs exactly one Return' },
        { node: 'get', message: 'Invalid config: The record has no field "trip.speed"' }
      ]
    );
  });
});
