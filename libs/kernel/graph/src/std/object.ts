import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { getPath, isRecord, type JsonRecord, setPath } from '../json.ts';
import { fieldsSchema } from '../schemas.ts';
import type { Json, NodeDef, PinSpec } from '../types.ts';

const CATEGORY = 'Objects';
const OBJECT = { object: {} };

const fieldsConfig = v.object({ fields: fieldsSchema });

type FieldsConfig = v.InferOutput<typeof fieldsConfig>;

const fieldPins = ({ fields }: FieldsConfig, optional: boolean, description: string): PinSpec[] =>
  fields.map((f) =>
    pin(f.name, f.type, { optional, description, ...(f.label ? { label: f.label } : {}) })
  );

const fieldsSummary = ({ fields }: FieldsConfig) =>
  fields.length ? `Fields: ${fields.map((f) => f.label ?? f.name).join(', ')}` : null;

const RECORD = { description: 'The record to read.' };

const KEYS = { description: 'The names of the fields.' };

const obj = (x: Json) => x as JsonRecord;

const keyList = (x: Json) => (x as Json[]).map(String);

export const objectNodes: NodeDef[] = [
  pureNode({
    type: 'std.object.get',
    title: 'Get Path',
    category: CATEGORY,
    description:
      'Reads a value from a record by its path, such as patient.address.zip, or items.0.code for the code of the first item.',
    level: 'advanced',
    keywords: ['field', 'property', 'read', 'path'],
    inputs: [
      pin('object', 'any', RECORD),
      pin('path', 'string', { description: 'Where the value is, with dots between the names.' })
    ],
    outputs: [
      pin('value', 'any', { description: 'The value found there.' }),
      pin('found', 'boolean', { description: 'Whether there is a value there.' })
    ],
    compute: ({ object, path }) => {
      const value = getPath(object ?? null, path as string);
      return { value, found: value !== null };
    }
  }),
  pureNode({
    type: 'std.object.set',
    title: 'Set Path',
    category: CATEGORY,
    description:
      'Gives a copy of a record with the value at a path, such as patient.address.zip, changed.',
    level: 'advanced',
    keywords: ['field', 'property', 'write', 'path', 'update'],
    inputs: [
      pin('object', 'any', { optional: true, description: 'The record to change.' }),
      pin('path', 'string', {
        description: 'Where to put the value, with dots between the names.'
      }),
      pin('value', 'any', { optional: true, description: 'The value to put there.' })
    ],
    outputs: [pin('object', 'any', { description: 'The changed copy.' })],
    compute: ({ object, path, value }) => ({
      object: setPath(object ?? null, path as string, value ?? null)
    })
  }),
  pureNode<FieldsConfig>({
    type: 'std.object.make',
    title: 'Make Object',
    category: CATEGORY,
    description: 'Builds a record from the fields you list, each filled from its own value.',
    level: 'basic',
    keywords: ['record', 'build', 'create', 'object'],
    summary: fieldsSummary,
    config: fieldsConfig,
    inputs: (c) => fieldPins(c, true, 'The value of this field.'),
    outputs: (c) => [
      pin(
        'object',
        { object: Object.fromEntries(c.fields.map((f) => [f.name, f.type])) },
        { description: 'The record.' }
      )
    ],
    compute: (inputs) => ({ object: inputs })
  }),
  pureNode<FieldsConfig>({
    type: 'std.object.break',
    title: 'Break Object',
    category: CATEGORY,
    description: 'Splits a record into the fields you list, each its own value.',
    level: 'basic',
    keywords: ['record', 'split', 'fields', 'object'],
    summary: fieldsSummary,
    config: fieldsConfig,
    inputs: [pin('object', OBJECT, { description: 'The record to split.' })],
    outputs: (c) => fieldPins(c, true, 'The value of this field.'),
    compute: ({ object }, { fields }) =>
      Object.fromEntries(fields.map((f) => [f.name, obj(object ?? {})[f.name] ?? null]))
  }),
  pureNode({
    type: 'std.object.merge',
    title: 'Merge',
    category: CATEGORY,
    description: 'Combines two records into one; when both have a field, the second one wins.',
    level: 'basic',
    keywords: ['record', 'combine', 'join', 'object'],
    inputs: [
      pin('a', OBJECT, { description: 'The first record.' }),
      pin('b', OBJECT, { description: 'The second record, whose fields win.' })
    ],
    outputs: [pin('object', OBJECT, { description: 'The combined record.' })],
    compute: ({ a, b }) => ({ object: { ...obj(a ?? {}), ...obj(b ?? {}) } })
  }),
  pureNode({
    type: 'std.object.compact',
    title: 'Drop Empty Fields',
    category: CATEGORY,
    description:
      'Gives a copy of a record without its empty fields, so merging it over another keeps the values it does not fill in.',
    level: 'basic',
    keywords: ['record', 'empty', 'blank', 'remove', 'clean', 'compact', 'object'],
    inputs: [pin('object', OBJECT, { optional: true, description: 'The record.' })],
    outputs: [pin('object', OBJECT, { description: 'The record without empty fields.' })],
    compute: ({ object }) => ({
      object: Object.fromEntries(
        Object.entries(obj(object ?? {})).filter(
          ([, x]) => x !== null && x !== '' && !(Array.isArray(x) && x.length === 0)
        )
      )
    })
  }),
  pureNode({
    type: 'std.object.keys',
    title: 'Keys',
    category: CATEGORY,
    description: 'Lists the names of the fields of a record.',
    level: 'advanced',
    keywords: ['record', 'fields', 'names', 'object'],
    inputs: [pin('object', OBJECT, RECORD)],
    outputs: [pin('keys', { list: 'string' }, KEYS)],
    compute: ({ object }) => ({ keys: Object.keys(obj(object ?? {})) })
  }),
  pureNode({
    type: 'std.object.values',
    title: 'Values',
    category: CATEGORY,
    description: 'Lists the values of the fields of a record.',
    level: 'advanced',
    keywords: ['record', 'fields', 'values', 'object'],
    inputs: [pin('object', OBJECT, RECORD)],
    outputs: [pin('values', { list: 'any' }, { description: 'The values of the fields.' })],
    compute: ({ object }) => ({ values: Object.values(obj(object ?? {})) })
  }),
  pureNode({
    type: 'std.object.has',
    title: 'Has Field',
    category: CATEGORY,
    description: 'True when a record has a field with the given name.',
    level: 'advanced',
    keywords: ['record', 'field', 'exists', 'object'],
    inputs: [
      pin('object', 'any', { optional: true, description: 'The record to check.' }),
      pin('key', 'string', { description: 'The name of the field.' })
    ],
    outputs: [pin('result', 'boolean', { description: 'Whether the record has the field.' })],
    compute: ({ object, key }) => ({
      result: isRecord(object) && Object.hasOwn(object, key as string)
    })
  }),
  pureNode({
    type: 'std.object.pick',
    title: 'Pick',
    category: CATEGORY,
    description: 'Gives a copy of a record with only the fields named.',
    level: 'advanced',
    keywords: ['record', 'fields', 'keep', 'object'],
    inputs: [
      pin('object', OBJECT, RECORD),
      pin('keys', { list: 'string' }, { description: 'The names of the fields to keep.' })
    ],
    outputs: [pin('object', OBJECT, { description: 'The copy with only those fields.' })],
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
    description: 'Gives a copy of a record without the fields named.',
    level: 'advanced',
    keywords: ['record', 'fields', 'remove', 'object'],
    inputs: [
      pin('object', OBJECT, RECORD),
      pin('keys', { list: 'string' }, { description: 'The names of the fields to leave out.' })
    ],
    outputs: [pin('object', OBJECT, { description: 'The copy without those fields.' })],
    compute: ({ object, keys }) => {
      const drop = new Set(keyList(keys ?? []));
      return {
        object: Object.fromEntries(Object.entries(obj(object ?? {})).filter(([k]) => !drop.has(k)))
      };
    }
  })
];
