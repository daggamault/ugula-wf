import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { deepEqual } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';

const CATEGORY = 'Logic';

const comparable = (title: string, a: Json, b: Json) =>
  (typeof a === 'number' && typeof b === 'number') ||
  (typeof a === 'string' && typeof b === 'string')
    ? ([a, b] as [number, number] | [string, string])
    : fail(`${title}: needs two numbers or two strings`);

const compareNode = (
  key: string,
  title: string,
  fn: (a: number | string, b: number | string) => boolean
) =>
  pureNode({
    type: `std.logic.${key}`,
    title,
    category: CATEGORY,
    description: `True when a ${title.toLowerCase()} b. Strings compare alphabetically (ISO dates compare chronologically).`,
    inputs: [pin('a', 'any'), pin('b', 'any')],
    outputs: [pin('result', 'boolean')],
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
    inputs: [pin('a', 'boolean'), pin('b', 'boolean')],
    outputs: [pin('result', 'boolean')],
    compute: ({ a, b }) => ({ result: fn(a === true, b === true) })
  });

export const logicNodes: NodeDef[] = [
  pureNode({
    type: 'std.logic.equal',
    title: 'Equal',
    category: CATEGORY,
    description: 'True when a and b are deeply equal.',
    inputs: [pin('a', 'any', { optional: true }), pin('b', 'any', { optional: true })],
    outputs: [pin('result', 'boolean')],
    compute: ({ a, b }) => ({ result: deepEqual(a ?? null, b ?? null) })
  }),
  pureNode({
    type: 'std.logic.not-equal',
    title: 'Not Equal',
    category: CATEGORY,
    description: 'True when a and b differ.',
    inputs: [pin('a', 'any', { optional: true }), pin('b', 'any', { optional: true })],
    outputs: [pin('result', 'boolean')],
    compute: ({ a, b }) => ({ result: !deepEqual(a ?? null, b ?? null) })
  }),
  compareNode('greater', 'Greater Than', (a, b) => a > b),
  compareNode('greater-or-equal', 'Greater Or Equal', (a, b) => a >= b),
  compareNode('less', 'Less Than', (a, b) => a < b),
  compareNode('less-or-equal', 'Less Or Equal', (a, b) => a <= b),
  boolNode('and', 'And', 'True when both are true.', (a, b) => a && b),
  boolNode('or', 'Or', 'True when either is true.', (a, b) => a || b),
  boolNode('xor', 'Xor', 'True when exactly one is true.', (a, b) => a !== b),
  pureNode({
    type: 'std.logic.not',
    title: 'Not',
    category: CATEGORY,
    description: 'Inverts a boolean.',
    inputs: [pin('value', 'boolean')],
    outputs: [pin('result', 'boolean')],
    compute: ({ value }) => ({ result: value !== true })
  }),
  pureNode({
    type: 'std.logic.is-null',
    title: 'Is Null',
    category: CATEGORY,
    description: 'True when the value is missing.',
    inputs: [pin('value', 'any', { optional: true })],
    outputs: [pin('result', 'boolean')],
    compute: ({ value }) => ({ result: value === null })
  }),
  pureNode({
    type: 'std.logic.coalesce',
    title: 'Coalesce',
    category: CATEGORY,
    description: 'The first value that is not null.',
    inputs: [pin('value', 'any', { optional: true }), pin('fallback', 'any', { optional: true })],
    outputs: [pin('result', 'any')],
    compute: ({ value, fallback }) => ({ result: value ?? fallback ?? null })
  }),
  pureNode({
    type: 'std.logic.select',
    title: 'Select',
    category: CATEGORY,
    description: 'Picks whenTrue or whenFalse based on the condition.',
    inputs: [
      pin('condition', 'boolean'),
      pin('whenTrue', 'any', { optional: true }),
      pin('whenFalse', 'any', { optional: true })
    ],
    outputs: [pin('result', 'any')],
    compute: ({ condition, whenTrue, whenFalse }) => ({
      result: (condition ? whenTrue : whenFalse) ?? null
    })
  })
];
