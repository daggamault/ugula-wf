import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { deepEqual } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';

const CATEGORY = 'Logic';

const RESULT = pin('result', 'boolean', { description: 'True or false.' });

const A = { description: 'The first value.' };

const B = { description: 'The second value.' };

const comparable = (title: string, a: Json, b: Json) =>
  (typeof a === 'number' && typeof b === 'number') ||
  (typeof a === 'string' && typeof b === 'string')
    ? ([a, b] as [number, number] | [string, string])
    : fail(`${title}: needs two numbers or two strings`);

const compareNode = (
  key: string,
  title: string,
  phrase: string,
  fn: (a: number | string, b: number | string) => boolean
) =>
  pureNode({
    type: `std.logic.${key}`,
    title,
    category: CATEGORY,
    description: `True when the first value is ${phrase} the second. Text compares alphabetically, and dates compare by time.`,
    level: 'basic',
    keywords: ['compare', 'condition'],
    inputs: [pin('a', 'any', A), pin('b', 'any', B)],
    outputs: [RESULT],
    compute: ({ a, b }) => {
      const [x, y] = comparable(title, a ?? null, b ?? null);
      return { result: fn(x, y) };
    }
  });

const boolNode = (
  key: string,
  title: string,
  description: string,
  fn: (a: boolean, b: boolean) => boolean
) =>
  pureNode({
    type: `std.logic.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords: ['condition', 'boolean'],
    inputs: [pin('a', 'boolean', A), pin('b', 'boolean', B)],
    outputs: [RESULT],
    compute: ({ a, b }) => ({ result: fn(a === true, b === true) })
  });

export const logicNodes: NodeDef[] = [
  pureNode({
    type: 'std.logic.equal',
    title: 'Equal',
    category: CATEGORY,
    description: 'True when both values are the same, including lists and records.',
    level: 'basic',
    keywords: ['compare', 'same', 'equals'],
    inputs: [pin('a', 'any', { optional: true, ...A }), pin('b', 'any', { optional: true, ...B })],
    outputs: [RESULT],
    compute: ({ a, b }) => ({ result: deepEqual(a ?? null, b ?? null) })
  }),
  pureNode({
    type: 'std.logic.not-equal',
    title: 'Not Equal',
    category: CATEGORY,
    description: 'True when the two values differ.',
    level: 'basic',
    keywords: ['compare', 'different'],
    inputs: [pin('a', 'any', { optional: true, ...A }), pin('b', 'any', { optional: true, ...B })],
    outputs: [RESULT],
    compute: ({ a, b }) => ({ result: !deepEqual(a ?? null, b ?? null) })
  }),
  compareNode('greater', 'Greater Than', 'greater than', (a, b) => a > b),
  compareNode('greater-or-equal', 'Greater Or Equal', 'at least', (a, b) => a >= b),
  compareNode('less', 'Less Than', 'less than', (a, b) => a < b),
  compareNode('less-or-equal', 'Less Or Equal', 'at most', (a, b) => a <= b),
  boolNode('and', 'And', 'True only when both values are true.', (a, b) => a && b),
  boolNode('or', 'Or', 'True when at least one of the values is true.', (a, b) => a || b),
  boolNode('xor', 'Xor', 'True when exactly one of the two values is true.', (a, b) => a !== b),
  pureNode({
    type: 'std.logic.not',
    title: 'Not',
    category: CATEGORY,
    description: 'Turns true into false and false into true.',
    level: 'basic',
    keywords: ['invert', 'opposite'],
    inputs: [pin('value', 'boolean', { description: 'The value to turn around.' })],
    outputs: [RESULT],
    compute: ({ value }) => ({ result: value !== true })
  }),
  pureNode({
    type: 'std.logic.is-null',
    title: 'Is Null',
    category: CATEGORY,
    description: 'True when the value is empty.',
    level: 'basic',
    keywords: ['empty', 'missing', 'blank'],
    inputs: [pin('value', 'any', { optional: true, description: 'The value to check.' })],
    outputs: [RESULT],
    compute: ({ value }) => ({ result: value === null })
  }),
  pureNode({
    type: 'std.logic.coalesce',
    title: 'Coalesce',
    category: CATEGORY,
    description: 'Gives the value, or the fallback when the value is empty.',
    level: 'basic',
    keywords: ['default', 'fallback', 'first'],
    inputs: [
      pin('value', 'any', { optional: true, description: 'The value to use when it is there.' }),
      pin('fallback', 'any', { optional: true, description: 'The value to use otherwise.' })
    ],
    outputs: [pin('result', 'any', { description: 'The value, or the fallback.' })],
    compute: ({ value, fallback }) => ({ result: value ?? fallback ?? null })
  }),
  pureNode({
    type: 'std.logic.select',
    title: 'Select',
    category: CATEGORY,
    description: 'Gives one value when the condition is true and another when it is false.',
    level: 'basic',
    keywords: ['if', 'choose', 'pick'],
    inputs: [
      pin('condition', 'boolean', { description: 'Which value to give.' }),
      pin('whenTrue', 'any', {
        optional: true,
        description: 'The value when the condition is true.'
      }),
      pin('whenFalse', 'any', {
        optional: true,
        description: 'The value when the condition is false.'
      })
    ],
    outputs: [pin('result', 'any', { description: 'The chosen value.' })],
    compute: ({ condition, whenTrue, whenFalse }) => ({
      result: (condition ? whenTrue : whenFalse) ?? null
    })
  })
];
