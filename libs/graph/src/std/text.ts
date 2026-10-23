import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { evaluateExpr } from '../expr.ts';
import { toText } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';
import { identifierPins, validExpressions } from './expression.ts';

const CATEGORY = 'Text';

const PLACEHOLDER = /\{\{([\s\S]+?)\}\}/g;

export const templateExpressions = (template: string) =>
  [...template.matchAll(PLACEHOLDER)].map((m) => (m[1] ?? '').trim());

const templateConfig = v.object({
  template: v.pipe(v.string(), validExpressions(templateExpressions))
});

const textNode = (key: string, title: string, description: string, fn: (s: string) => string) =>
  pureNode({
    type: `std.text.${key}`,
    title,
    category: CATEGORY,
    description,
    inputs: [pin('text', 'string')],
    outputs: [pin('result', 'string')],
    compute: ({ text }) => ({ result: fn(text as string) })
  });

const testNode = (key: string, title: string, fn: (s: string, part: string) => boolean) =>
  pureNode({
    type: `std.text.${key}`,
    title,
    category: CATEGORY,
    description: `Outputs true when the text ${title.toLowerCase()} the given part.`,
    inputs: [pin('text', 'string'), pin('part', 'string')],
    outputs: [pin('result', 'boolean')],
    compute: ({ text, part }) => ({ result: fn(text as string, part as string) })
  });

export const textNodes: NodeDef[] = [
  pureNode<v.InferOutput<typeof templateConfig>>({
    type: 'std.text.template',
    title: 'Template',
    category: CATEGORY,
    description: 'Builds text like `Claim {{ claim.id }} for {{ name }}`; names become inputs.',
    config: templateConfig,
    inputs: ({ template }) => identifierPins(templateExpressions(template)),
    outputs: [pin('text', 'string')],
    compute: (inputs, { template }, ctx) => ({
      text: template.replace(PLACEHOLDER, (_, src: string) =>
        toText(evaluateExpr(src.trim(), inputs, { now: ctx.now }))
      )
    })
  }),
  pureNode({
    type: 'std.text.length',
    title: 'Length',
    category: CATEGORY,
    description: 'Outputs how many characters the text has.',
    inputs: [pin('text', 'string')],
    outputs: [pin('length', 'integer')],
    compute: ({ text }) => ({ length: (text as string).length })
  }),
  textNode('upper', 'Upper Case', 'Outputs the text in upper case.', (s) => s.toUpperCase()),
  textNode('lower', 'Lower Case', 'Outputs the text in lower case.', (s) => s.toLowerCase()),
  textNode('trim', 'Trim', 'Removes spaces and line breaks from both ends of the text.', (s) =>
    s.trim()
  ),
  testNode('contains', 'Contains', (s, p) => s.includes(p)),
  testNode('starts-with', 'Starts With', (s, p) => s.startsWith(p)),
  testNode('ends-with', 'Ends With', (s, p) => s.endsWith(p)),
  pureNode({
    type: 'std.text.replace',
    title: 'Replace',
    category: CATEGORY,
    description: 'Replaces every occurrence of find with replacement.',
    inputs: [
      pin('text', 'string'),
      pin('find', 'string'),
      pin('replacement', 'string', { default: '' })
    ],
    outputs: [pin('result', 'string')],
    compute: ({ text, find, replacement }) => ({
      result: (text as string).replaceAll(find as string, replacement as string)
    })
  }),
  pureNode({
    type: 'std.text.split',
    title: 'Split',
    category: CATEGORY,
    description: 'Splits text into a list wherever the separator appears.',
    inputs: [pin('text', 'string'), pin('separator', 'string', { default: ',' })],
    outputs: [pin('parts', { list: 'string' })],
    compute: ({ text, separator }) => ({ parts: (text as string).split(separator as string) })
  }),
  pureNode({
    type: 'std.text.join',
    title: 'Join',
    category: CATEGORY,
    description: 'Joins list items into text with a separator.',
    inputs: [pin('items', { list: 'any' }), pin('separator', 'string', { default: '' })],
    outputs: [pin('text', 'string')],
    compute: ({ items, separator }) => ({
      text: (items as Json[]).map(toText).join(separator as string)
    })
  }),
  pureNode({
    type: 'std.text.substring',
    title: 'Substring',
    category: CATEGORY,
    description: 'Characters from start up to (not including) end.',
    inputs: [
      pin('text', 'string'),
      pin('start', 'integer', { default: 0 }),
      pin('end', 'integer', { optional: true })
    ],
    outputs: [pin('result', 'string')],
    compute: ({ text, start, end }) => ({
      result: (text as string).slice(start as number, end === null ? undefined : (end as number))
    })
  }),
  pureNode({
    type: 'std.text.pad',
    title: 'Pad',
    category: CATEGORY,
    description: 'Pads text to a length on the start or end.',
    config: v.object({ side: v.optional(v.picklist(['start', 'end']), 'start') }),
    inputs: [
      pin('text', 'string'),
      pin('length', 'integer'),
      pin('fill', 'string', { default: ' ' })
    ],
    outputs: [pin('result', 'string')],
    compute: ({ text, length, fill }, { side }) => ({
      result:
        side === 'start'
          ? (text as string).padStart(length as number, fill as string)
          : (text as string).padEnd(length as number, fill as string)
    })
  })
];
