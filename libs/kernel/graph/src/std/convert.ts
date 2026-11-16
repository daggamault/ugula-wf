import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { parseNumber } from '../expr-functions.ts';
import { toText } from '../json.ts';
import { jsonSchema, valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef } from '../types.ts';
import { checkValue, KIND_NAME } from '../value-types.ts';
import { oneLine } from './expression.ts';

const CATEGORY = 'Conversion';

const constantConfig = v.pipe(
  v.object({ type: valueTypeSchema, value: jsonSchema }),
  v.check((c) => checkValue(c.type, c.value) === null, 'Value does not match its type')
);

const codeConfig = v.object({ kind: v.pipe(v.string(), v.regex(KIND_NAME)) });

export const convertNodes: NodeDef[] = [
  pureNode<v.InferOutput<typeof constantConfig>>({
    type: 'std.value',
    title: 'Constant',
    category: CATEGORY,
    description: 'A fixed value you type in, such as a number, some text or a list.',
    level: 'basic',
    keywords: ['constant', 'value', 'fixed', 'literal'],
    summary: ({ value }) => (value === null ? null : oneLine(toText(value))),
    config: constantConfig,
    inputs: [],
    outputs: ({ type }) => [pin('value', type, { description: 'The value you typed in.' })],
    compute: (_, { value }) => ({ value })
  }),
  pureNode<v.InferOutput<typeof codeConfig>>({
    type: 'std.convert.to-code',
    title: 'To Code',
    category: CATEGORY,
    description:
      'Treats text as a code of one code set, such as a modifier built from letters, so it can go where that kind of code is expected.',
    level: 'basic',
    keywords: ['convert', 'code', 'cast', 'hcpcs', 'icd-10', 'modifier'],
    summary: ({ kind }) => `Code Set: ${kind}`,
    config: codeConfig,
    inputs: [pin('text', 'string', { optional: true, description: 'The text of the code.' })],
    outputs: ({ kind }) => [
      pin('code', { code: kind }, { description: 'The code, or nothing when the text is blank.' })
    ],
    compute: ({ text }) => ({ code: toText(text ?? null).trim() || null })
  }),
  pureNode({
    type: 'std.convert.to-number',
    title: 'To Number',
    category: CATEGORY,
    description: 'Reads text such as "12.50" as a number.',
    level: 'basic',
    keywords: ['convert', 'parse', 'number'],
    inputs: [pin('value', 'any', { description: 'The text or number to read.' })],
    outputs: [pin('number', 'number', { description: 'The number.' })],
    compute: ({ value }) => ({ number: parseNumber(value ?? null) })
  }),
  pureNode({
    type: 'std.convert.to-text',
    title: 'To Text',
    category: CATEGORY,
    description: 'Turns any value into readable text.',
    level: 'basic',
    keywords: ['convert', 'text', 'string'],
    inputs: [pin('value', 'any', { optional: true, description: 'The value to turn into text.' })],
    outputs: [pin('text', 'string', { description: 'The value as text.' })],
    compute: ({ value }) => ({ text: toText(value ?? null) })
  }),
  pureNode({
    type: 'std.convert.to-boolean',
    title: 'To Boolean',
    category: CATEGORY,
    description:
      'Turns a value into true or false: false for empty, false, 0, blank text and "false", true for anything else.',
    level: 'advanced',
    keywords: ['convert', 'boolean', 'yes', 'no'],
    inputs: [
      pin('value', 'any', { optional: true, description: 'The value to turn into true or false.' })
    ],
    outputs: [pin('boolean', 'boolean', { description: 'True or false.' })],
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
    description: 'Reads JSON text as a value the workflow can use.',
    level: 'advanced',
    keywords: ['convert', 'json', 'parse'],
    inputs: [pin('text', 'string', { description: 'The JSON text.' })],
    outputs: [pin('value', 'any', { description: 'The value the JSON holds.' })],
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
    description: 'Writes any value as JSON text, for example to send it to a web service.',
    level: 'advanced',
    keywords: ['convert', 'json', 'serialize'],
    inputs: [pin('value', 'any', { optional: true, description: 'The value to write.' })],
    outputs: [pin('text', 'string', { description: 'The value as JSON text.' })],
    compute: ({ value }) => ({ text: JSON.stringify(value ?? null) })
  })
];
