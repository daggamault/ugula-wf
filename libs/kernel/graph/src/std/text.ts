import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { formatMoney, MAX_RANGE } from '../expr-functions.ts';
import { getPath, toText } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';
import { oneLine } from './expression.ts';

const CATEGORY = 'Text';

const PLACEHOLDER = /\{\s*([A-Za-z_$][\w$]*)((?:\.[\w$]+)*)\s*\}/g;

const OPTIONAL_PART = /\[([^[\]]*)\]/g;

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

const fillTemplate = (template: string, valueAt: (name: string, path: string) => Json) => {
  const textAt = (name: string, path: string) => toText(valueAt(name, path));
  const fill = (part: string) =>
    part.replace(PLACEHOLDER, (_, name: string, path: string) => textAt(name, path));
  const filled = (part: string) =>
    [...part.matchAll(PLACEHOLDER)].every(([, name = '', path = '']) => textAt(name, path));
  return fill(template.replace(OPTIONAL_PART, (_, part: string) => (filled(part) ? part : '')))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

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
      'Builds text from a pattern such as "Claim {number} for {name}"; each name in braces is a value to connect, and {patient.name} reads a field of one. Empty values leave nothing behind, and a part in square brackets, such as "[ (member {memberId})]", is left out whole when a value in it is empty.',
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
      text: fillTemplate(template, (name, path) => getPath(inputs[name] ?? null, path))
    })
  }),
  pureNode({
    type: 'std.text.fill',
    title: 'Fill Template',
    category: CATEGORY,
    description:
      'Builds text from a pattern that arrives on a wire, such as a message kept in a table, filling each name in braces, such as {number} or {patient.name}, from the values. Empty values leave nothing behind, and a part in square brackets is left out whole when a value in it is empty.',
    level: 'basic',
    keywords: ['text', 'template', 'format', 'message', 'merge', 'pattern', 'placeholder'],
    inputs: [
      pin('pattern', 'string', {
        description: 'The pattern, such as "Claim {number} for {name}".'
      }),
      pin(
        'values',
        { object: {} },
        { optional: true, description: 'The values the pattern names, by name.' }
      )
    ],
    outputs: [pin('text', 'string', { description: 'The finished text.' })],
    compute: ({ pattern, values }) => ({
      text: fillTemplate(pattern as string, (name, path) => getPath(values ?? null, name + path))
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
  textNode(
    'capitalize',
    'Capitalize',
    'Writes the first letter of the text as a capital and leaves the rest as it is.',
    (s) => s.charAt(0).toUpperCase() + s.slice(1)
  ),
  textNode('trim', 'Trim', 'Removes spaces and line breaks from both ends of the text.', (s) =>
    s.trim()
  ),
  testNode('contains', 'Contains', (s, p) => s.includes(p)),
  testNode('starts-with', 'Starts with', (s, p) => s.startsWith(p)),
  testNode('ends-with', 'Ends with', (s, p) => s.endsWith(p)),
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
      pin('items', { list: 'any' }, { optional: true, description: 'The items to join.' }),
      pin('separator', 'string', { default: '', description: 'What goes between the items.' }),
      pin('last', 'string', {
        optional: true,
        label: 'Last Separator',
        description:
          'What goes before the last item instead, such as " and " for "a, b and c"; the separator when empty.'
      })
    ],
    outputs: [pin('text', 'string', { description: 'The joined text.' })],
    compute: ({ items, separator, last }) => {
      const texts = ((items ?? []) as Json[]).map(toText);
      const end = texts.length > 1 && last ? texts.pop() : undefined;
      const text = texts.join(separator as string);
      return { text: end === undefined ? text : `${text}${last}${end}` };
    }
  }),
  pureNode({
    type: 'std.text.count',
    title: 'Count with Noun',
    category: CATEGORY,
    description:
      'Writes a count with its noun in agreement, such as 1 warning or 3 warnings, or nothing when the count is missing.',
    level: 'basic',
    keywords: ['text', 'plural', 'singular', 'count', 'number', 'noun'],
    inputs: [
      pin('count', 'number', { optional: true, description: 'How many there are.' }),
      pin('singular', 'string', { description: 'The noun for one, such as warning.' }),
      pin('plural', 'string', {
        optional: true,
        description:
          'The noun for any other count, such as people; the noun for one with an s when empty.'
      })
    ],
    outputs: [
      pin('text', 'string', {
        description: 'The count and its noun, or nothing when the count is missing.'
      })
    ],
    compute: ({ count, singular, plural }) => {
      if (count === null) return { text: null };
      const noun = count === 1 ? singular : plural || `${singular}s`;
      return { text: `${toText(count)} ${noun}` };
    }
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
