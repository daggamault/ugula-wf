import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { roundTo } from '../expr-functions.ts';
import type { NodeDef } from '../types.ts';

const CATEGORY = 'Math';

const RESULT = pin('result', 'number', {
  description: 'The result, or nothing when a number is missing.'
});

const finite = (title: string, n: number) =>
  Number.isFinite(n) ? n : fail(`${title}: result is not a finite number`);

const binary = (
  key: string,
  title: string,
  description: string,
  fn: (a: number, b: number) => number
) =>
  pureNode({
    type: `std.math.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords: ['math', 'calculate'],
    inputs: [
      pin('a', 'number', { optional: true, description: 'The first number.' }),
      pin('b', 'number', { optional: true, description: 'The second number.' })
    ],
    outputs: [RESULT],
    compute: ({ a, b }) => ({
      result: a === null || b === null ? null : finite(title, fn(a as number, b as number))
    })
  });

const unary = (key: string, title: string, description: string, fn: (x: number) => number) =>
  pureNode({
    type: `std.math.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords: ['math', 'calculate'],
    inputs: [pin('value', 'number', { optional: true, description: 'The number to work on.' })],
    outputs: [RESULT],
    compute: ({ value }) => ({ result: value === null ? null : finite(title, fn(value as number)) })
  });

const DIRECTIONS = ['nearest', 'up', 'down'] as const;

const roundConfig = v.object({ direction: v.optional(v.picklist(DIRECTIONS), 'nearest') });

const shifted = (x: number, digits: number) => (digits >= 0 ? x * 10 ** digits : x / 10 ** -digits);

const snapped = (n: number) => {
  const whole = Math.round(n);
  return Math.abs(n - whole) < 1e-9 * Math.max(1, Math.abs(n)) ? whole : n;
};

const rounded = (x: number, digits: number, direction: (typeof DIRECTIONS)[number]) =>
  direction === 'nearest'
    ? roundTo(x, digits)
    : shifted((direction === 'up' ? Math.ceil : Math.floor)(snapped(shifted(x, digits))), -digits);

const nonZero = (title: string, b: number) => (b === 0 ? fail(`${title}: division by zero`) : b);

export const mathNodes: NodeDef[] = [
  binary('add', 'Add', 'Adds two numbers (a + b).', (a, b) => a + b),
  binary('subtract', 'Subtract', 'Subtracts b from a (a − b).', (a, b) => a - b),
  binary('multiply', 'Multiply', 'Multiplies two numbers (a × b).', (a, b) => a * b),
  binary(
    'divide',
    'Divide',
    'Divides a by b (a ÷ b). Fails when b is 0.',
    (a, b) => a / nonZero('Divide', b)
  ),
  binary(
    'modulo',
    'Modulo',
    'Outputs the remainder after dividing a by b. Fails when b is 0.',
    (a, b) => a % nonZero('Modulo', b)
  ),
  binary('power', 'Power', 'Raises a to the power of b.', (a, b) => a ** b),
  binary('min', 'Min', 'Outputs the smaller of two numbers.', Math.min),
  binary('max', 'Max', 'Outputs the larger of two numbers.', Math.max),
  unary('abs', 'Absolute', 'Outputs the number without its sign, so -5 becomes 5.', Math.abs),
  unary('negate', 'Negate', 'Flips the sign of a number, so 5 becomes -5.', (x) => -x),
  unary('floor', 'Floor', 'Rounds a number down to the previous whole number.', Math.floor),
  unary('ceil', 'Ceil', 'Rounds a number up to the next whole number.', Math.ceil),
  unary('sqrt', 'Square Root', 'Outputs the square root of a number.', Math.sqrt),
  pureNode<v.InferOutput<typeof roundConfig>>({
    type: 'std.math.round',
    title: 'Round',
    category: CATEGORY,
    description:
      'Rounds a number to the given number of decimal places, to the nearest, or up or down, such as 12.31 miles up to 12.4.',
    level: 'basic',
    keywords: ['math', 'decimals', 'up', 'down', 'ceil', 'floor', 'tenth'],
    summary: ({ direction }) => (direction === 'nearest' ? null : `Round ${direction}`),
    config: roundConfig,
    inputs: [
      pin('value', 'number', { optional: true, description: 'The number to round.' }),
      pin('digits', 'integer', {
        default: 0,
        description: 'How many decimal places to keep, such as 1 for tenths or -2 for hundreds.'
      })
    ],
    outputs: [
      pin('result', 'number', {
        description: 'The rounded number, or nothing when the number is missing.'
      })
    ],
    compute: ({ value, digits }, { direction }) => ({
      result:
        value === null
          ? null
          : finite('Round', rounded(value as number, digits as number, direction))
    })
  }),
  pureNode({
    type: 'std.math.sum',
    title: 'Sum',
    category: CATEGORY,
    description: 'Adds up every number in a list.',
    level: 'basic',
    keywords: ['math', 'total'],
    inputs: [pin('values', { list: 'number' }, { description: 'The numbers to add up.' })],
    outputs: [pin('result', 'number', { description: 'The total.' })],
    compute: ({ values }) => ({ result: (values as number[]).reduce((a, b) => a + (b ?? 0), 0) })
  })
];
