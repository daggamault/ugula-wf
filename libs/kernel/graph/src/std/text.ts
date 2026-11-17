import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { formatMoney, MAX_RANGE } from '../expr-functions.ts';
import { getPath, toText } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';
import { oneLine } from './expression.ts';

const CATEGORY = 'Text';

const PLACEHOLDER = /\{\s*([A-Za-z_$][\w$]*)((?:\.[\w$]+)*)\s*\}/g;

const placeholderNames = (template: string) => [
  ...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))
];

const templateConfig = v.object({
  template: v.pipe(
    v.optional(v.string(), ''),
    v.check(
      (t) => placeholderNames(t).every((n) => !(n in Object.prototype)),
      'A placeholder uses a reserved name'
    )
  )
});

const TEXT = { description: 'The text to work on.' };

const textNode = (key: string, title: string, description: string, fn: (s: string) => string) =>
  pureNode({
    type: `std.text.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords: ['text'],
    inputs: [pin('text', 'string', TEXT)],
    outputs: [pin('result', 'string', { description: 'The changed text.' })],
    compute: ({ text }) => ({ result: fn(text as string) })
  });

const testNode = (key: string, title: string, fn: (s: string, part: string) => boolean) =>
  pureNode({
    type: `std.text.${key}`,
    title,
    category: CATEGORY,
    description: `True when the text ${title.toLowerCase()} the given part.`,
    level: 'basic',
    keywords: ['text', 'search', 'match'],
    inputs: [
      pin('text', 'string', { description: 'The text to look in.' }),
      pin('part', 'string', { description: 'The part to look for.' })
    ],
    outputs: [pin('result', 'boolean', { description: 'Whether the part was found.' })],
    compute: ({ text, part }) => ({ result: fn(text as string, part as string) })
  });

export const textNodes: NodeDef[] = [
  pureNode<v.InferOutput<typeof templateConfig>>({
    type: 'std.text.template',
    title: 'Text Template',
    category: CATEGORY,
    description:
      'Builds text from a pattern such as "Claim {number} for {name}"; each name in braces is a value to connect, and {patient.name} reads a field of one. Empty values leave nothing behind.',
    level: 'basic',
    keywords: ['text', 'template', 'format', 'message', 'merge', 'subject', 'summary'],
    summary: ({ template }) => oneLine(template),
    config: templateConfig,
    inputs: ({ template }) =>
      placeholderNames(template).map((name) =>
        pin(name, 'any', { optional: true, description: 'A value the text fills in.' })
      ),
    outputs: [pin('text', 'string', { description: 'The finished text.' })],
    compute: (inputs, { template }) => ({
      text: template
        .replace(PLACEHOLDER, (_, name: string, path: string) =>
          toText(getPath(inputs[name] ?? null, path))
        )
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
    })
  }),
  pureNode({
    type: 'std.text.length',
    title: 'Length',
    category: CATEGORY,
    description: 'Counts the characters in the text.',
    level: 'basic',
    keywords: ['text', 'count', 'size'],
    inputs: [pin('text', 'string', TEXT)],
    outputs: [pin('length', 'integer', { description: 'How many characters the text has.' })],
    compute: ({ text }) => ({ length: (text as string).length })
  }),
  textNode('upper', 'Upper Case', 'Writes the text in capital letters.', (s) => s.toUpperCase()),
  textNode('lower', 'Lower Case', 'Writes the text in small letters.', (s) => s.toLowerCase()),
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
    description:
      'Replaces every place the text has what to find with the replacement; finding nothing changes nothing.',
    level: 'basic',
    keywords: ['text', 'substitute', 'change'],
    inputs: [
      pin('text', 'string', TEXT),
      pin('find', 'string', { description: 'The text to find.' }),
      pin('replacement', 'string', { default: '', description: 'The text to put in its place.' })
    ],
    outputs: [pin('result', 'string', { description: 'The changed text.' })],
    compute: ({ text, find, replacement }) => ({
      result:
        find === '' ? text : (text as string).replaceAll(find as string, replacement as string)
    })
  }),
  pureNode({
    type: 'std.text.split',
    title: 'Split',
    category: CATEGORY,
    description: 'Splits text into a list wherever the separator appears.',
    level: 'basic',
    keywords: ['text', 'divide', 'list'],
    inputs: [
      pin('text', 'string', { description: 'The text to split.' }),
      pin('separator', 'string', { default: ',', description: 'What separates the parts.' })
    ],
    outputs: [pin('parts', { list: 'string' }, { description: 'The parts, in order.' })],
    compute: ({ text, separator }) => ({ parts: (text as string).split(separator as string) })
  }),
  pureNode({
    type: 'std.text.join',
    title: 'Join',
    category: CATEGORY,
    description: 'Joins the items of a list into one text, with a separator between them.',
    level: 'basic',
    keywords: ['text', 'combine', 'concatenate', 'list'],
    inputs: [
      pin('items', { list: 'any' }, { description: 'The items to join.' }),
      pin('separator', 'string', { default: '', description: 'What goes between the items.' })
    ],
    outputs: [pin('text', 'string', { description: 'The joined text.' })],
    compute: ({ items, separator }) => ({
      text: (items as Json[]).map(toText).join(separator as string)
    })
  }),
  pureNode({
    type: 'std.text.money',
    title: 'Money',
    category: CATEGORY,
    description: 'Writes an amount in cents as dollars, such as 1250 as $12.50.',
    level: 'basic',
    keywords: ['money', 'dollars', 'cents', 'currency', 'format', 'amount'],
    inputs: [pin('cents', 'number', { optional: true, description: 'The amount in cents.' })],
    outputs: [
      pin('text', 'string', {
        description: 'The amount in dollars, or nothing when it is missing.'
      })
    ],
    compute: ({ cents }) => ({ text: cents === null ? null : formatMoney(cents as number) })
  }),
  pureNode({
    type: 'std.text.substring',
    title: 'Substring',
    category: CATEGORY,
    description:
      'Takes part of the text, from the start position up to but not including the end position.',
    level: 'basic',
    keywords: ['text', 'slice', 'part'],
    inputs: [
      pin('text', 'string', TEXT),
      pin('start', 'integer', {
        default: 0,
        description: 'Where the part starts, counting from 0.'
      }),
      pin('end', 'integer', {
        optional: true,
        description: 'Where the part ends; the end of the text when empty.'
      })
    ],
    outputs: [pin('result', 'string', { description: 'The part of the text.' })],
    compute: ({ text, start, end }) => ({
      result: (text as string).slice(start as number, end === null ? undefined : (end as number))
    })
  }),
  pureNode({
    type: 'std.text.pad',
    title: 'Pad',
    category: CATEGORY,
    description: 'Fills the text out to a length at its start or end, such as 7 becoming 007.',
    level: 'basic',
    keywords: ['text', 'zero', 'fill', 'length'],
    config: v.object({ side: v.optional(v.picklist(['start', 'end']), 'start') }),
    inputs: [
      pin('text', 'string', TEXT),
      pin('length', 'integer', { description: 'How long the text should be.' }),
      pin('fill', 'string', { default: ' ', description: 'What to fill with.' })
    ],
    outputs: [pin('result', 'string', { description: 'The filled out text.' })],
    compute: ({ text, length, fill }, { side }) => {
      const n = length as number;
      if (n > MAX_RANGE) fail(`Pad: at most ${MAX_RANGE} characters`);
      return {
        result:
          side === 'start'
            ? (text as string).padStart(n, fill as string)
            : (text as string).padEnd(n, fill as string)
      };
    }
  })
];
