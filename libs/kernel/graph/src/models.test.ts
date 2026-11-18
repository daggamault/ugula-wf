import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pin } from './define.ts';
import { createModelNodes, type Model, modelType } from './models.ts';
import { invokeNode } from './testing.ts';

const PERSON: Model = {
  key: 'test.person',
  name: 'person',
  title: 'Person',
  category: 'Test',
  description: 'a person',
  fields: [
    { name: 'name', type: 'string', label: 'Name', description: 'What the person is called.' },
    { name: 'age', type: 'integer', label: 'Age', description: 'How old the person is.' }
  ]
};

const PERSON_TYPE = { object: { name: 'string', age: 'integer' }, model: 'test.person' } as const;

const FIELD_PINS = [
  pin('name', 'string', {
    label: 'Name',
    optional: true,
    description: 'What the person is called.'
  }),
  pin('age', 'integer', { label: 'Age', optional: true, description: 'How old the person is.' })
];

const nodes = () => {
  const [breaker, maker] = createModelNodes([PERSON]);
  assert.ok(breaker && maker);
  return { breaker, maker };
};

describe('modelType', () => {
  it('types a model as an object of its fields, named after the model', () => {
    assert.deepEqual(modelType(PERSON), PERSON_TYPE);
  });
});

describe('createModelNodes', () => {
  it('makes a break and a make node per model', () => {
    const other = { ...PERSON, key: 'test.pet', title: 'Pet' };
    assert.deepEqual(
      createModelNodes([PERSON, other]).map((n) => [n.type, n.title]),
      [
        ['test.person.break', 'Break Person'],
        ['test.person.make', 'Make Person'],
        ['test.pet.break', 'Break Pet'],
        ['test.pet.make', 'Make Pet']
      ]
    );
  });

  it('describes the break node and gives it an optional model input and labelled field outputs', async () => {
    const { breaker } = nodes();
    assert.deepEqual(
      [breaker.category, breaker.description, breaker.level, breaker.keywords],
      ['Test', 'Splits a person into its fields.', 'basic', ['break', 'split', 'fields', 'person']]
    );
    const { signature } = await invokeNode(breaker);
    assert.deepEqual(signature, {
      execIn: [],
      execOut: [],
      inputs: [
        pin('person', PERSON_TYPE, {
          label: 'Person',
          optional: true,
          description: 'The Person to split.'
        })
      ],
      outputs: FIELD_PINS
    });
  });

  it('describes the make node and gives it optional field inputs and a model output', async () => {
    const { maker } = nodes();
    assert.deepEqual(
      [maker.description, maker.keywords],
      ['Builds a person from its fields.', ['make', 'build', 'fields', 'person']]
    );
    const { signature } = await invokeNode(maker);
    assert.deepEqual(signature, {
      execIn: [],
      execOut: [],
      inputs: FIELD_PINS,
      outputs: [pin('person', PERSON_TYPE, { label: 'Person', description: 'The Person built.' })]
    });
  });

  it('breaks a model into its fields, dropping unknown keys', async () => {
    const { breaker } = nodes();
    const broken = await invokeNode(breaker, {
      inputs: { person: { name: 'Ada', age: 36, x: 1 } }
    });
    assert.deepEqual(broken.outputs, { name: 'Ada', age: 36 });
  });

  it('breaks a missing model or field into nulls', async () => {
    const { breaker } = nodes();
    assert.deepEqual((await invokeNode(breaker)).outputs, { name: null, age: null });
    assert.deepEqual((await invokeNode(breaker, { inputs: { person: { name: 'Ada' } } })).outputs, {
      name: 'Ada',
      age: null
    });
  });

  it('makes a model from its fields, missing ones as null', async () => {
    const { maker } = nodes();
    const made = await invokeNode(maker, { inputs: { name: 'Ada' } });
    assert.deepEqual(made.outputs, { person: { name: 'Ada', age: null } });
  });

  it('checks each field against its type by label', async () => {
    const { maker } = nodes();
    await assert.rejects(invokeNode(maker, { inputs: { age: 1.5 } }), {
      message: 'Input "Age" of "Make Person": expected integer, got number'
    });
  });
});
