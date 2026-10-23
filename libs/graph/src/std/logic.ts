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
    description: 'Outputs true when both inputs hold the same value, including lists and objects.',
    inputs: [pin('a', 'any', { optional: true }), pin('b', 'any', { optional: true })],
    outputs: [pin('result', 'boolean')],
    compute: ({ a, b }) => ({ result: deepEqual(a ?? null, b ?? null) })
  }),
  pureNode({
    type: 'std.logic.not-equal',
    title: 'Not Equal',
    category: CATEGORY,
    description: 'Outputs true when the two inputs hold different values.',
    inputs: [pin('a', 'any', { optional: true }), pin('b', 'any', { optional: true })],
    outputs: [pin('result', 'boolean')],
    compute: ({ a, b }) => ({ result: !deepEqual(a ?? null, b ?? null) })
  }),
  compareNode('greater', 'Greater Than', (a, b) => a > b),
  compareNode('greater-or-equal', 'Greater Or Equal', (a, b) => a >= b),
  compareNode('less', 'Less Than', (a, b) => a < b),
  compareNode('less-or-equal', 'Less Or Equal', (a, b) => a <= b),
  boolNode('and', 'And', 'Outputs true only when both inputs are true.', (a, b) => a && b),
  boolNode('or', 'Or', 'Outputs true when at least one input is true.', (a, b) => a || b),
  boolNode(
    'xor',
    'Xor',
    'Outputs true when exactly one of the two inputs is true.',
    (a, b) => a !== b
  ),
  pureNode({
    type: 'std.logic.not',
    title: 'Not',
    category: CATEGORY,
    description: 'Outputs the opposite of a true or false input.',
    inputs: [pin('value', 'boolean')],
    outputs: [pin('result', 'boolean')],
    compute: ({ value }) => ({ result: value !== true })
  }),
  pureNode({
    type: 'std.logic.is-null',
    title: 'Is Null',
    category: CATEGORY,
    description: 'Outputs true when the input has no value.',
    inputs: [pin('value', 'any', { optional: true })],
    outputs: [pin('result', 'boolean')],
    compute: ({ value }) => ({ result: value === null })
  }),
  pureNode({
    type: 'std.logic.coalesce',
    title: 'Coalesce',
    category: CATEGORY,
    description: 'Outputs the first input that has a value, skipping empty ones.',
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
