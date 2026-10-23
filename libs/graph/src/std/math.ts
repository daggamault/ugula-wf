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
  binary('add', 'Add', 'a + b', (a, b) => a + b),
  binary('subtract', 'Subtract', 'a - b', (a, b) => a - b),
  binary('multiply', 'Multiply', 'a × b', (a, b) => a * b),
  binary('divide', 'Divide', 'a ÷ b', (a, b) => a / nonZero('Divide', b)),
  binary('modulo', 'Modulo', 'Remainder of a ÷ b', (a, b) => a % nonZero('Modulo', b)),
  binary('power', 'Power', 'a raised to b', (a, b) => a ** b),
  binary('min', 'Min', 'Smaller of a and b', Math.min),
  binary('max', 'Max', 'Larger of a and b', Math.max),
  unary('abs', 'Absolute', 'Absolute value', Math.abs),
  unary('negate', 'Negate', 'Flips the sign', (x) => -x),
  unary('floor', 'Floor', 'Rounds down', Math.floor),
  unary('ceil', 'Ceil', 'Rounds up', Math.ceil),
  unary('sqrt', 'Square Root', 'Square root', Math.sqrt),
  pureNode({
    type: 'std.math.round',
    title: 'Round',
    category: CATEGORY,
    description: 'Rounds to a number of decimal digits.',
    inputs: [pin('value', 'number'), pin('digits', 'integer', { default: 0 })],
    outputs: [pin('result', 'number')],
    compute: ({ value, digits }) => ({ result: roundTo(value as number, digits as number) })
  }),
  pureNode({
    type: 'std.math.sum',
    title: 'Sum',
    category: CATEGORY,
    description: 'Adds all numbers in a list.',
    inputs: [pin('values', { list: 'number' })],
    outputs: [pin('result', 'number')],
    compute: ({ values }) => ({ result: (values as number[]).reduce((a, b) => a + (b ?? 0), 0) })
  })
];
