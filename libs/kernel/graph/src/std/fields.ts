import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { pathLabel } from '../documentation.ts';
import { getPath, setPath } from '../json.ts';
import { valueTypeSchema } from '../schemas.ts';
import type { Adoption, NodeDef, ValueType } from '../types.ts';
import { fieldType } from '../value-types.ts';

const CATEGORY = 'Objects';

const fieldConfig = v.pipe(
  v.object({
    record: v.optional(valueTypeSchema, 'any'),
    path: v.optional(v.string(), '')
  }),
  v.check(
    ({ record, path }) => path === '' || fieldType(record, path) !== null,
    (issue) => `The record has no field "${(issue.input as { path: string }).path}"`
  )
);

type FieldConfig = v.InferOutput<typeof fieldConfig>;

const typeOf = ({ record, path }: FieldConfig): ValueType => fieldType(record, path) ?? 'any';

const summary = ({ path }: FieldConfig) => (path ? pathLabel(path) : 'Choose a field');

const valuePin = (c: FieldConfig, description: string, optional = false) =>
  c.path
    ? [
        pin('value', typeOf(c), {
          label: pathLabel(c.path),
          description,
          ...(optional ? { optional } : {})
        })
      ]
    : [];

const ADOPTS_RECORD: Adoption[] = [{ pins: /^record$/, key: 'record', from: 'record' }];

export const fieldNodes: NodeDef[] = [
  pureNode<FieldConfig>({
    type: 'std.object.get-field',
    title: 'Get Field',
    category: CATEGORY,
    description:
      'Reads one field of a record, such as the pickup state of the encounter facts. Wire the record in, then choose the field; the value appears once a field is chosen.',
    level: 'basic',
    keywords: ['field', 'get', 'read', 'property', 'record', 'prepopulate'],
    summary,
    config: fieldConfig,
    adopts: ADOPTS_RECORD,
    inputs: ({ record }) => [
      pin('record', record, { optional: true, description: 'The record to read.' })
    ],
    outputs: (c) => valuePin(c, 'The value of the field, or nothing when it is empty.'),
    compute: ({ record }, { path }) => (path ? { value: getPath(record ?? null, path) } : {})
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
    adopts: ADOPTS_RECORD,
    inputs: (c) => [
      pin('record', c.record, { optional: true, description: 'The record to change.' }),
      ...valuePin(c, 'The new value of the field.', true)
    ],
    outputs: ({ record }) => [
      pin('record', record, { description: 'The copy with the field changed.' })
    ],
    compute: ({ record, value }, { path }) => ({
      record: path ? setPath(record ?? null, path, value ?? null) : (record ?? null)
    })
  })
];
