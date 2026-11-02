import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { roundTo } from '../expr-functions.ts';
import type { NodeDef } from '../types.ts';

const CATEGORY = 'Math';

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
    inputs: [pin('a', 'number'), pin('b', 'number')],
    outputs: [pin('result', 'number')],
    compute: ({ a, b }) => ({ result: finite(title, fn(a as number, b as number)) })
  });

const unary = (key: string, title: string, description: string, fn: (x: number) => number) =>
  pureNode({
    type: `std.math.${key}`,
    title,
    category: CATEGORY,
    description,
    inputs: [pin('value', 'number')],
    outputs: [pin('result', 'number')],
    compute: ({ value }) => ({ result: finite(title, fn(value as number)) })
  });

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
  pureNode({
    type: 'std.math.round',
    title: 'Round',
    category: CATEGORY,
    description: 'Rounds a number to the given number of decimal places.',
    inputs: [pin('value', 'number'), pin('digits', 'integer', { default: 0 })],
    outputs: [pin('result', 'number')],
    compute: ({ value, digits }) => ({ result: roundTo(value as number, digits as number) })
  }),
  pureNode({
    type: 'std.math.sum',
    title: 'Sum',
    category: CATEGORY,
    description: 'Adds up every number in a list.',
    inputs: [pin('values', { list: 'number' })],
    outputs: [pin('result', 'number')],
    compute: ({ values }) => ({ result: (values as number[]).reduce((a, b) => a + (b ?? 0), 0) })
  })
];
