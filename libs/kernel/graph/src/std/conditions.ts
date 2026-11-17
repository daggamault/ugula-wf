import * as v from 'valibot';
import { branchNode, pin, pureNode } from '../define.ts';
import { nameLabel } from '../documentation.ts';
import { toText } from '../json.ts';
import { fieldsSchema } from '../schemas.ts';
import type { Json, NodeDef, PinSpec, Values } from '../types.ts';
import { type ConditionOp, conditionSchema, holds } from './tables.ts';

const MATCH_MODES = ['all', 'any'] as const;

const ALONE: readonly ConditionOp[] = ['empty', 'present'];

const conditionConfig = v.pipe(
  v.object({
    match: v.optional(v.picklist(MATCH_MODES), 'all'),
    inputs: v.optional(fieldsSchema, []),
    rules: v.optional(
      v.array(
        v.pipe(
          v.strictObject({
            field: v.string(),
            ...conditionSchema.entries,
            input: v.exactOptional(v.string())
          }),
          v.check(
            (r) =>
              r.input === undefined ||
              (r.value === undefined && r.input !== r.field && !ALONE.includes(r.op)),
            'A rule compares with a value or another input, and only when its test takes one'
          )
        )
      ),
      []
    )
  }),
  v.check(
    ({ inputs, rules }) =>
      rules.every((r) =>
        [r.field, ...(r.input === undefined ? [] : [r.input])].every((n) =>
          inputs.some((i) => i.name === n)
        )
      ),
    'Each rule must test one of the inputs'
  )
);

type ConditionConfig = v.InferOutput<typeof conditionConfig>;

type Rule = ConditionConfig['rules'][number];

const PHRASES: Readonly<Record<ConditionOp, string>> = {
  is: 'is',
  isNot: 'is not',
  oneOf: 'is one of',
  notOneOf: 'is not one of',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  startsWith: 'starts with',
  empty: 'is empty',
  present: 'is filled in'
};

const valueText = (value: Json) =>
  Array.isArray(value) ? value.map(toText).join(', ') : toText(value);

const inputLabel = (name: string, inputs: ConditionConfig['inputs']) =>
  inputs.find((i) => i.name === name)?.label ?? nameLabel(name);

const ruleSentence = (rule: Rule, inputs: ConditionConfig['inputs']) => {
  const subject = inputLabel(rule.field, inputs);
  if (rule.input !== undefined)
    return `${subject} ${PHRASES[rule.op]} ${inputLabel(rule.input, inputs)}`;
  const value = rule.value ?? null;
  if (rule.op === 'empty' || rule.op === 'present' || (rule.op === 'is' && value === null))
    return `${subject} ${PHRASES[rule.op === 'is' ? 'empty' : rule.op]}`;
  return `${subject} ${PHRASES[rule.op]} ${valueText(value)}`;
};

const conditionSentence = ({ match, inputs, rules }: ConditionConfig) =>
  rules.length
    ? rules.map((r) => ruleSentence(r, inputs)).join(match === 'all' ? ' and ' : ' or ')
    : null;

const evaluate = (config: ConditionConfig, values: Values) => {
  const held = config.rules.filter((r) =>
    holds(
      { op: r.op, value: r.input === undefined ? (r.value ?? null) : (values[r.input] ?? null) },
      values[r.field] ?? null
    )
  );
  const result = config.match === 'all' ? held.length === config.rules.length : held.length > 0;
  return { result, reasons: held.map((r) => ruleSentence(r, config.inputs)) };
};

const inputPins = ({ inputs }: ConditionConfig): PinSpec[] =>
  inputs.map((f) =>
    pin(f.name, f.type, {
      optional: true,
      description: 'A value the rules test.',
      ...(f.label ? { label: f.label } : {})
    })
  );

const REASONS = pin(
  'reasons',
  { list: 'string' },
  { description: 'Each rule that held, in plain words.' }
);

const META = {
  config: conditionConfig,
  summary: conditionSentence,
  inputs: inputPins
};

export const conditionNodes: NodeDef[] = [
  pureNode<ConditionConfig>({
    ...META,
    type: 'std.logic.condition',
    title: 'Condition',
    category: 'Logic',
    description:
      'Checks rules you build from its inputs, such as Pickup State is NH, or Loaded Miles is more than the Mileage Limit input, and gives true when all of them hold, or any of them if you choose.',
    level: 'basic',
    keywords: ['condition', 'rule', 'check', 'test', 'when', 'and', 'or'],
    outputs: [pin('result', 'boolean', { description: 'Whether the rules hold.' }), REASONS],
    compute: (inputs, config) => evaluate(config, inputs)
  }),
  branchNode<ConditionConfig>({
    ...META,
    type: 'std.flow.if',
    title: 'If',
    category: 'Flow',
    description:
      'Goes one way when rules you build from its inputs hold, such as Payer is Medicaid and Emergency is false, and the other way when they do not.',
    level: 'basic',
    keywords: ['if', 'condition', 'rule', 'branch', 'when', 'otherwise'],
    exits: {
      true: { label: 'True', description: 'The rules hold.' },
      false: { label: 'False', description: 'The rules do not hold.' }
    },
    outputs: [REASONS],
    compute: (inputs, config) => {
      const { result, reasons } = evaluate(config, inputs);
      return { exit: result ? 'true' : 'false', outputs: { reasons } };
    }
  })
];
