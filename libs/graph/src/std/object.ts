import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { getPath, isRecord, type JsonRecord, setPath } from '../json.ts';
import { fieldsSchema } from '../schemas.ts';
import type { Json, NodeDef, PinSpec } from '../types.ts';

const CATEGORY = 'Objects';
const OBJECT = { object: {} };

const fieldsConfig = v.object({ fields: fieldsSchema });

type FieldsConfig = v.InferOutput<typeof fieldsConfig>;

const fieldPins = ({ fields }: FieldsConfig, optional: boolean): PinSpec[] =>
  fields.map((f) => pin(f.name, f.type, { optional, ...(f.label ? { label: f.label } : {}) }));

const obj = (x: Json) => x as JsonRecord;

const keyList = (x: Json) => (x as Json[]).map(String);

export const objectNodes: NodeDef[] = [
  pureNode({
    type: 'std.object.get',
    title: 'Get Path',
    category: CATEGORY,
    description: 'Reads a dotted path such as `patient.address.zip` or `items.0.code`.',
    inputs: [pin('object', 'any'), pin('path', 'string')],
    outputs: [pin('value', 'any'), pin('found', 'boolean')],
    compute: ({ object, path }) => {
      const value = getPath(object ?? null, path as string);
      return { value, found: value !== null };
    }
  }),
  pureNode({
    type: 'std.object.set',
    title: 'Set Path',
    category: CATEGORY,
    description: 'A copy of the object with the dotted path set to value.',
    inputs: [
      pin('object', 'any', { optional: true }),
      pin('path', 'string'),
      pin('value', 'any', { optional: true })
    ],
    outputs: [pin('object', 'any')],
    compute: ({ object, path, value }) => ({
      object: setPath(object ?? null, path as string, value ?? null)
    })
  }),
  pureNode<FieldsConfig>({
    type: 'std.object.make',
    title: 'Make Object',
    category: CATEGORY,
    description: 'Builds an object from typed fields.',
    config: fieldsConfig,
    inputs: (c) => fieldPins(c, true),
    outputs: (c) => [
      pin('object', { object: Object.fromEntries(c.fields.map((f) => [f.name, f.type])) })
    ],
    compute: (inputs) => ({ object: inputs })
  }),
  pureNode<FieldsConfig>({
    type: 'std.object.break',
    title: 'Break Object',
    category: CATEGORY,
    description: 'Splits an object into typed field outputs.',
    config: fieldsConfig,
    inputs: [pin('object', OBJECT)],
    outputs: (c) => fieldPins(c, true),
    compute: ({ object }, { fields }) =>
      Object.fromEntries(fields.map((f) => [f.name, obj(object ?? {})[f.name] ?? null]))
  }),
  pureNode({
    type: 'std.object.merge',
    title: 'Merge',
    category: CATEGORY,
    description: 'Shallow merge; fields in b win.',
    inputs: [pin('a', OBJECT), pin('b', OBJECT)],
    outputs: [pin('object', OBJECT)],
    compute: ({ a, b }) => ({ object: { ...obj(a ?? {}), ...obj(b ?? {}) } })
  }),
  pureNode({
    type: 'std.object.keys',
    title: 'Keys',
    category: CATEGORY,
    description: 'Field names of the object.',
    inputs: [pin('object', OBJECT)],
    outputs: [pin('keys', { list: 'string' })],
    compute: ({ object }) => ({ keys: Object.keys(obj(object ?? {})) })
  }),
  pureNode({
    type: 'std.object.values',
    title: 'Values',
    category: CATEGORY,
    description: 'Field values of the object.',
    inputs: [pin('object', OBJECT)],
    outputs: [pin('values', { list: 'any' })],
    compute: ({ object }) => ({ values: Object.values(obj(object ?? {})) })
  }),
  pureNode({
    type: 'std.object.has',
    title: 'Has Field',
    category: CATEGORY,
    description: 'True when the object has the field.',
    inputs: [pin('object', 'any', { optional: true }), pin('key', 'string')],
    outputs: [pin('result', 'boolean')],
    compute: ({ object, key }) => ({
      result: isRecord(object) && Object.hasOwn(object, key as string)
    })
  }),
  pureNode({
    type: 'std.object.pick',
    title: 'Pick',
    category: CATEGORY,
    description: 'Only the listed fields.',
    inputs: [pin('object', OBJECT), pin('keys', { list: 'string' })],
    outputs: [pin('object', OBJECT)],
    compute: ({ object, keys }) => {
      const o = obj(object ?? {});
      return {
        object: Object.fromEntries(
          keyList(keys ?? [])
            .filter((k) => Object.hasOwn(o, k))
            .map((k) => [k, o[k] ?? null])
        )
      };
    }
  }),
  pureNode({
    type: 'std.object.omit',
    title: 'Omit',
    category: CATEGORY,
    description: 'All fields except the listed ones.',
    inputs: [pin('object', OBJECT), pin('keys', { list: 'string' })],
    outputs: [pin('object', OBJECT)],
    compute: ({ object, keys }) => {
      const drop = new Set(keyList(keys ?? []));
      return {
        object: Object.fromEntries(Object.entries(obj(object ?? {})).filter(([k]) => !drop.has(k)))
      };
    }
  })
];
