import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { valueKinds } from '@ugula/catalog';
import { ENTRY_TYPE, type GraphDef, type NodeInstance, type ValueType } from '@ugula/graph';
import { testNodes } from '../testing.ts';
import { createCatalog } from './catalog.ts';
import { addWired, pickerEntries } from './flow.ts';
import { describeType } from './pins.ts';
import {
  FOR_EACH_TYPE,
  fieldEntries,
  fieldNodeInfo,
  fieldsOf,
  GET_FIELD,
  modelOf,
  SET_FIELD
} from './record-fields.ts';

const models = valueKinds.models ?? {};

const claimModel = models.claim;
assert.ok(claimModel);

const CLAIM: ValueType = {
  object: Object.fromEntries(claimModel.fields.map((f) => [f.name, f.type])),
  model: 'claim'
};

const catalog = createCatalog(testNodes, { models });

const def: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [
      { name: 'claim', type: CLAIM },
      { name: 'claims', type: { list: CLAIM } }
    ],
    outputs: []
  },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const getter = (path: string, type: string = GET_FIELD.type): NodeInstance => ({
  id: 'g',
  type,
  version: 1,
  config: { record: CLAIM, path }
});

describe('models of record types', () => {
  it('finds the model a record is named after, and lists its fields with their labels', () => {
    assert.equal(modelOf(CLAIM, models)?.title, 'Claim');
    assert.equal(modelOf({ object: {} }, models), null);
    const lines = fieldsOf(CLAIM, models).find((f) => f.name === 'lines');
    assert.equal(lines?.label, 'Charge Lines');
  });

  it('offers only the model fields a saved type still has', () => {
    const older: ValueType = { object: { totalCents: 'integer' }, model: 'claim' };
    assert.deepEqual(
      fieldsOf(older, models).map((f) => f.name),
      ['totalCents']
    );
  });

  it('labels the fields of a custom record from their names', () => {
    assert.deepEqual(
      fieldsOf({ object: { payerName: 'string' } }, models).map((f) => f.label),
      ['Payer Name']
    );
  });

  it('names a record pin after its model', () => {
    assert.equal(describeType(CLAIM, valueKinds), 'Claim');
    assert.equal(describeType({ list: CLAIM }, valueKinds), 'List of Claim');
  });
});

describe('field nodes', () => {
  it('reads as the field they get, from the record they read', () => {
    assert.deepEqual(fieldNodeInfo(getter('lines'), models), {
      label: 'Charge Lines',
      description: 'The lines charged, priced.',
      from: 'Claim'
    });
    assert.equal(catalog.titleOf(getter('lines')), 'Charge Lines');
    assert.equal(catalog.summaryOf(getter('lines')), 'From Claim');
    assert.equal(catalog.titleOf(getter('lines', SET_FIELD.type)), 'Set Charge Lines');
    assert.equal(catalog.summaryOf(getter('lines', SET_FIELD.type)), 'On Claim');
  });

  it('labels the value pin with the field and its description', () => {
    const out = catalog.signatureOf(getter('totalCents'), def)?.outputs[0];
    assert.deepEqual(
      [out?.label, out?.description],
      ['Total Charge', 'The total charge, in cents.']
    );
  });

  it('labels a nested path step by step', () => {
    const coverage = models.coverage;
    assert.ok(coverage);
    const inst: NodeInstance = {
      id: 'g',
      type: GET_FIELD.type,
      version: 1,
      config: {
        record: {
          object: {
            primary: {
              object: Object.fromEntries(coverage.fields.map((f) => [f.name, f.type])),
              model: 'coverage'
            }
          }
        },
        path: 'primary.memberId'
      }
    };
    assert.equal(fieldNodeInfo(inst, models)?.label, 'Primary › Member ID');
  });

  it('leaves other nodes, and field nodes with no field chosen, alone', () => {
    assert.equal(fieldNodeInfo({ id: 'a', type: 'std.math.add', version: 1 }, models), null);
    assert.equal(fieldNodeInfo(getter(''), models), null);
  });
});

describe('dragging off a record', () => {
  it('offers its fields first, as getters set to that field', () => {
    const entries = pickerEntries(def, catalog, { node: 'entry', pin: 'claim', side: 'out' });
    const first = entries[0];
    assert.equal(first?.category, 'Claim Fields');
    assert.deepEqual(
      entries.filter((e) => e.category === 'Claim Fields').map((e) => e.title),
      claimModel.fields.map((f) => f.label)
    );
    assert.deepEqual(first?.config, { record: CLAIM, path: claimModel.fields[0]?.name });
  });

  it('places the getter wired to the record, with its field chosen', () => {
    const entry = fieldEntries(CLAIM, models).find((e) => e.title === 'Charge Lines');
    assert.ok(entry);
    const added = addWired(
      def,
      catalog,
      entry,
      { x: 0, y: 0 },
      {
        node: 'entry',
        pin: 'claim',
        side: 'out'
      }
    );
    const node = added.def.nodes.at(-1);
    assert.deepEqual(node?.config, { record: CLAIM, path: 'lines' });
    assert.deepEqual(added.def.edges, [
      { from: 'entry', fromPin: 'claim', to: added.id, toPin: 'record' }
    ]);
    assert.equal(catalog.titleOf(node as NodeInstance), 'Charge Lines');
  });

  it('offers For Each first when dragging off a list', () => {
    const entries = pickerEntries(def, catalog, { node: 'entry', pin: 'claims', side: 'out' });
    assert.equal(entries[0]?.type, FOR_EACH_TYPE);
  });

  it('offers no fields when dragging into an input', () => {
    const entries = pickerEntries(def, catalog, { node: 'entry', pin: 'claim', side: 'in' });
    assert.ok(!entries.some((e) => e.category === 'Claim Fields'));
  });
});
