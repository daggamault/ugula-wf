import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { toText } from '../json.ts';
import { valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef, PinSpec } from '../types.ts';
import { isEmpty } from './tables.ts';

const MAX_OPTIONS = 20;

const chooseConfig = v.object({
  mode: v.optional(v.picklist(['first', 'byCase']), 'first'),
  type: v.optional(valueTypeSchema, 'any'),
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_OPTIONS)), 2),
  cases: v.optional(
    v.pipe(
      v.array(v.strictObject({ when: v.string() })),
      v.maxLength(MAX_OPTIONS),
      v.check(
        (cases) => new Set(cases.map((c) => c.when)).size === cases.length,
        'Each case can appear once'
      )
    ),
    []
  )
});

type ChooseConfig = v.InferOutput<typeof chooseConfig>;

const numbered = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

const inputPins = ({ mode, type, count, cases }: ChooseConfig): PinSpec[] =>
  mode === 'first'
    ? numbered('option', count).map((name, i) =>
        pin(name, type, {
          optional: true,
          label: `Option ${i + 1}`,
          description: 'A value to use when the options before it are empty.'
        })
      )
    : [
        pin('key', 'any', { optional: true, description: 'The value that picks the case.' }),
        ...cases.map((c, i) =>
          pin(`case${i + 1}`, type, {
            optional: true,
            label: `When ${c.when}`,
            description: `The value to use when the key is ${c.when}.`
          })
        ),
        pin('otherwise', type, {
          optional: true,
          description: 'The value to use when no case matches the key.'
        })
      ];

const choose = (inputs: Record<string, Json>, { mode, count, cases }: ChooseConfig): Json => {
  if (mode === 'first')
    return (
      numbered('option', count)
        .map((n) => inputs[n] ?? null)
        .find((x) => !isEmpty(x)) ?? null
    );
  const key = toText(inputs.key ?? null);
  const i = cases.findIndex((c) => c.when === key);
  return (i < 0 ? inputs.otherwise : inputs[`case${i + 1}`]) ?? null;
};

export const chooseNodes: NodeDef[] = [
  pureNode<ChooseConfig>({
    type: 'std.logic.choose',
    title: 'Choose Value',
    category: 'Logic',
    description:
      'Picks one value: the first of its options that is filled in, or the value for the case that matches a key, such as a reason for each state, with a value to use otherwise.',
    level: 'basic',
    keywords: ['choose', 'pick', 'first', 'default', 'fallback', 'case', 'select', 'coalesce'],
    summary: ({ mode, count, cases }) =>
      mode === 'first'
        ? `First filled in of ${count}`
        : cases.length
          ? `${cases.map((c) => c.when).join(', ')} or otherwise`
          : null,
    config: chooseConfig,
    inputs: inputPins,
    outputs: ({ type }) => [pin('value', type, { description: 'The chosen value.' })],
    compute: (inputs, config) => ({ value: choose(inputs, config) })
  })
];
