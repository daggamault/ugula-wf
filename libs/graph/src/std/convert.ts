import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { parseNumber } from '../expr-functions.ts';
import { toText } from '../json.ts';
import { jsonSchema, valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef } from '../types.ts';
import { checkValue } from '../value-types.ts';

const CATEGORY = 'Conversion';

const constantConfig = v.pipe(
  v.object({ type: valueTypeSchema, value: jsonSchema }),
  v.check((c) => checkValue(c.type, c.value) === null, 'Value does not match its type')
);

export const convertNodes: NodeDef[] = [
  pureNode<v.InferOutput<typeof constantConfig>>({
    type: 'std.value',
    title: 'Constant',
    category: CATEGORY,
    description: 'A fixed typed value.',
    config: constantConfig,
    inputs: [],
    outputs: ({ type }) => [pin('value', type)],
    compute: (_, { value }) => ({ value })
  }),
  pureNode({
    type: 'std.convert.to-number',
    title: 'To Number',
    category: CATEGORY,
    description: 'Parses text such as "12.50" into a number.',
    inputs: [pin('value', 'any')],
    outputs: [pin('number', 'number')],
    compute: ({ value }) => ({ number: parseNumber(value ?? null) })
  }),
  pureNode({
    type: 'std.convert.to-text',
    title: 'To Text',
    category: CATEGORY,
    description: 'Formats any value as text.',
    inputs: [pin('value', 'any', { optional: true })],
    outputs: [pin('text', 'string')],
    compute: ({ value }) => ({ text: toText(value ?? null) })
  }),
  pureNode({
    type: 'std.convert.to-boolean',
    title: 'To Boolean',
    category: CATEGORY,
    description: 'True for anything except null, false, 0, "", and "false".',
    inputs: [pin('value', 'any', { optional: true })],
    outputs: [pin('boolean', 'boolean')],
    compute: ({ value }) => ({
      boolean: !(
        value === null ||
        value === false ||
        value === 0 ||
        value === '' ||
        value === 'false'
      )
    })
  }),
  pureNode({
    type: 'std.convert.parse-json',
    title: 'Parse JSON',
    category: CATEGORY,
    description: 'Parses JSON text.',
    inputs: [pin('text', 'string')],
    outputs: [pin('value', 'any')],
    compute: ({ text }) => {
      try {
        return { value: JSON.parse(text as string) as Json };
      } catch {
        return fail('Parse JSON: invalid JSON');
      }
    }
  }),
  pureNode({
    type: 'std.convert.to-json',
    title: 'To JSON',
    category: CATEGORY,
    description: 'Serializes a value to JSON text.',
    inputs: [pin('value', 'any', { optional: true })],
    outputs: [pin('text', 'string')],
    compute: ({ value }) => ({ text: JSON.stringify(value ?? null) })
  })
];
