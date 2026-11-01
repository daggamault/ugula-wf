import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createModelNodes, type Model, modelType } from './models.ts';
import { invokeNode } from './testing.ts';

const PERSON: Model = {
  key: 'test.person',
  name: 'person',
  title: 'Person',
  category: 'Test',
  description: 'a person',
  fields: [
    { name: 'name', type: 'string', label: 'Name' },
    { name: 'age', type: 'integer', label: 'Age' }
  ]
};

describe('models', () => {
  it('types a model as an object of its fields', () => {
    assert.deepEqual(modelType(PERSON), { object: { name: 'string', age: 'integer' } });
  });

  it('generates labelled break and make nodes', async () => {
    const [breaker, maker] = createModelNodes([PERSON]);
    if (!breaker || !maker) throw new Error('missing nodes');
    assert.equal(breaker.type, 'test.person.break');
    assert.equal(maker.title, 'Make Person');
    const made = await invokeNode(maker, { inputs: { name: 'Ada' } });
    assert.deepEqual(made.outputs, { person: { name: 'Ada', age: null } });
    assert.equal(made.signature.inputs[1]?.label, 'Age');
    const broken = await invokeNode(breaker, {
      inputs: { person: { name: 'Ada', age: 36, x: 1 } }
    });
    assert.deepEqual(broken.outputs, { name: 'Ada', age: 36 });
  });
});
