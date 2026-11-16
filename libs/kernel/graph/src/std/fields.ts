import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { pathLabel } from '../documentation.ts';
import { getPath, setPath } from '../json.ts';
import { valueTypeSchema } from '../schemas.ts';
import type { NodeDef, ValueType } from '../types.ts';
import { fieldType } from '../value-types.ts';

const CATEGORY = 'Objects';

const fieldConfig = v.pipe(
  v.object({
    record: valueTypeSchema,
    path: v.pipe(v.string(), v.nonEmpty('Choose a field'))
  }),
  v.check(
    ({ record, path }) => fieldType(record, path) !== null,
    (issue) => `The record has no field "${(issue.input as { path: string }).path}"`
  )
);

type FieldConfig = v.InferOutput<typeof fieldConfig>;

const typeOf = ({ record, path }: FieldConfig): ValueType => fieldType(record, path) ?? 'any';

const summary = ({ path }: FieldConfig) => pathLabel(path);

export const fieldNodes: NodeDef[] = [
  pureNode<FieldConfig>({
    type: 'std.object.get-field',
    title: 'Get Field',
    category: CATEGORY,
    description:
      'Reads one field of a record, such as the pickup state of the encounter facts. Choose the field from the record wired in.',
    level: 'basic',
    keywords: ['field', 'get', 'read', 'property', 'record', 'prepopulate'],
    summary,
    config: fieldConfig,
    inputs: ({ record }) => [
      pin('record', record, { optional: true, description: 'The record to read.' })
    ],
    outputs: (c) => [
      pin('value', typeOf(c), {
        label: pathLabel(c.path),
        description: 'The value of the field, or nothing when it is empty.'
      })
    ],
    compute: ({ record }, { path }) => ({ value: getPath(record ?? null, path) })
  }),
  pureNode<FieldConfig>({
    type: 'std.object.set-field',
    title: 'Set Field',
    category: CATEGORY,
    description:
      'Gives a copy of a record with one field changed, such as setting the transport reason of the encounter facts. Choose the field from the record wired in.',
    level: 'basic',
    keywords: ['field', 'set', 'write', 'update', 'property', 'record', 'prepopulate'],
    summary,
    config: fieldConfig,
    inputs: (c) => [
      pin('record', c.record, { optional: true, description: 'The record to change.' }),
      pin('value', typeOf(c), {
        label: pathLabel(c.path),
        optional: true,
        description: 'The new value of the field.'
      })
    ],
    outputs: ({ record }) => [
      pin('record', record, { description: 'The copy with the field changed.' })
    ],
    compute: ({ record, value }, { path }) => ({
      record: setPath(record ?? null, path, value ?? null)
    })
  })
];
