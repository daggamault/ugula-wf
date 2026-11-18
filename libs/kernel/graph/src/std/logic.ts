import * as v from 'valibot';
import { adoptsType, pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { deepEqual } from '../json.ts';
import { type TypeConfig, typeConfig } from '../schemas.ts';
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
  pureNode<TypeConfig>({
    type: `std.logic.${key}`,
    title,
    category: CATEGORY,
    description: `True when the first value is ${phrase} the second. Text compares alphabetically, and dates compare by time.`,
    level: 'basic',
    keywords: ['compare', 'condition'],
    config: typeConfig,
    adopts: adoptsType(/^(a|b)$/),
    inputs: ({ type }) => [pin('a', type, A), pin('b', type, B)],
    outputs: [RESULT],
    compute: ({ a, b }) => {
      const [x, y] = comparable(title, a ?? null, b ?? null);
      return { result: fn(x, y) };
    }
  });

const equalNode = (
  key: string,
  title: string,
  description: string,
  keywords: string[],
  fn: (a: Json, b: Json) => boolean
) =>
  pureNode<TypeConfig>({
    type: `std.logic.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords,
    config: typeConfig,
    adopts: adoptsType(/^(a|b)$/),
    inputs: ({ type }) => [
      pin('a', type, { optional: true, ...A }),
      pin('b', type, { optional: true, ...B })
    ],
    outputs: [RESULT],
    compute: ({ a, b }) => ({ result: fn(a ?? null, b ?? null) })
  });

const gateConfig = v.object({
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(20)), 2)
});

type GateConfig = v.InferOutput<typeof gateConfig>;

type Gate = {
  key: string;
  title: string;
  description: string;
  keywords: string[];
  summary: (count: number) => string;
  fn: (conditions: boolean[]) => boolean;
};

const gateNode = ({ key, title, description, keywords, summary, fn }: Gate) =>
  pureNode<GateConfig>({
    type: `std.logic.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords: ['condition', 'boolean', 'gate', ...keywords],
    summary: ({ count }) => summary(count),
    config: gateConfig,
    inputs: ({ count }) =>
      Array.from({ length: count }, (_, i) =>
        pin(`condition${i + 1}`, 'boolean', {
          label: `Condition ${i + 1}`,
          description: 'A condition to combine.'
        })
      ),
    outputs: [RESULT],
    compute: (inputs, { count }) => ({
      result: fn(Array.from({ length: count }, (_, i) => inputs[`condition${i + 1}`] === true))
    })
  });

export const logicNodes: NodeDef[] = [
  equalNode(
    'equal',
    'Equal',
    'True when both values are the same, including lists and records.',
    ['compare', 'same', 'equals'],
    deepEqual
  ),
  equalNode(
    'not-equal',
    'Not Equal',
    'True when the two values differ.',
    ['compare', 'different'],
    (a, b) => !deepEqual(a, b)
  ),
  compareNode('greater', 'Greater Than', 'greater than', (a, b) => a > b),
  compareNode('greater-or-equal', 'Greater or Equal', 'at least', (a, b) => a >= b),
  compareNode('less', 'Less Than', 'less than', (a, b) => a < b),
  compareNode('less-or-equal', 'Less or Equal', 'at most', (a, b) => a <= b),
  gateNode({
    key: 'and',
    title: 'And',
    description: 'True only when every condition is true.',
    keywords: ['all', 'every', 'both'],
    summary: (count) => `All ${count} conditions`,
    fn: (conditions) => conditions.every(Boolean)
  }),
  gateNode({
    key: 'or',
    title: 'Or',
    description: 'True when at least one condition is true.',
    keywords: ['any', 'either'],
    summary: (count) => `Any of ${count} conditions`,
    fn: (conditions) => conditions.some(Boolean)
  }),
  pureNode({
    type: 'std.logic.xor',
    title: 'Xor',
    category: CATEGORY,
    description: 'True when exactly one of the two values is true.',
    level: 'basic',
    keywords: ['condition', 'boolean', 'exclusive'],
    inputs: [pin('a', 'boolean', A), pin('b', 'boolean', B)],
    outputs: [RESULT],
    compute: ({ a, b }) => ({ result: (a === true) !== (b === true) })
  }),
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
  pureNode<TypeConfig>({
    type: 'std.logic.coalesce',
    title: 'Coalesce',
    category: CATEGORY,
    description: 'Gives the value, or the fallback when the value is empty.',
    level: 'basic',
    keywords: ['default', 'fallback', 'first'],
    config: typeConfig,
    adopts: adoptsType(/^(value|fallback)$/),
    inputs: ({ type }) => [
      pin('value', type, { optional: true, description: 'The value to use when it is there.' }),
      pin('fallback', type, { optional: true, description: 'The value to use otherwise.' })
    ],
    outputs: ({ type }) => [pin('result', type, { description: 'The value, or the fallback.' })],
    compute: ({ value, fallback }) => ({ result: value ?? fallback ?? null })
  }),
  pureNode<TypeConfig>({
    type: 'std.logic.select',
    title: 'Select',
    category: CATEGORY,
    description: 'Gives one value when the condition is true and another when it is false.',
    level: 'basic',
    keywords: ['if', 'choose', 'pick'],
    config: typeConfig,
    adopts: adoptsType(/^(whenTrue|whenFalse)$/),
    inputs: ({ type }) => [
      pin('condition', 'boolean', { description: 'Which value to give.' }),
      pin('whenTrue', type, {
        optional: true,
        label: 'When True',
        description: 'The value when the condition is true.'
      }),
      pin('whenFalse', type, {
        optional: true,
        label: 'When False',
        description: 'The value when the condition is false.'
      })
    ],
    outputs: ({ type }) => [pin('result', type, { description: 'The chosen value.' })],
    compute: ({ condition, whenTrue, whenFalse }) => ({
      result: (condition ? whenTrue : whenFalse) ?? null
    })
  })
];
