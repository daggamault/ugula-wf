import * as v from 'valibot';
import { defineNode, next, pin, pureNode } from '../define.ts';
import type {
  Json,
  NodeContext,
  NodeDef,
  PinSpec,
  Signature,
  SignatureContext,
  Values
} from '../types.ts';

const CATEGORY = 'Lists';

const ruleRef = {
  rule: v.pipe(v.string(), v.nonEmpty('Choose a rule')),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  item: v.pipe(v.string(), v.nonEmpty('Choose the input each item goes to'))
};

const mapConfig = v.object(ruleRef);

const testConfig = v.object({
  ...ruleRef,
  test: v.pipe(v.string(), v.nonEmpty('Choose the output that keeps an item'))
});

type MapConfig = v.InferOutput<typeof mapConfig>;
type TestConfig = v.InferOutput<typeof testConfig>;

type Plan = { sig: Signature; item: PinSpec; shared: PinSpec[] };

const planOf = ({ rule, version, item }: MapConfig, ctx: SignatureContext): Plan | null => {
  if (!ctx.signatureOf) return null;
  const sig = ctx.signatureOf({ type: rule, version });
  if (!sig) throw new Error(`Unknown rule ${rule}@${version}`);
  if (sig.execIn.length || sig.execOut.length) throw new Error(`${rule} is not a rule`);
  const each = sig.inputs.find((p) => p.name === item);
  if (!each) throw new Error(`${rule} has no input "${item}"`);
  return { sig, item: each, shared: sig.inputs.filter((p) => p !== each) };
};

const testedPlan = (c: TestConfig, ctx: SignatureContext) => {
  const plan = planOf(c, ctx);
  const out = plan?.sig.outputs.find((p) => p.name === c.test);
  if (plan && !out) throw new Error(`${c.rule} has no output "${c.test}"`);
  if (out && out.type !== 'boolean')
    throw new Error(`"${c.test}" of ${c.rule} is not true or false`);
  return plan;
};

const itemType = (plan: Plan | null) => plan?.item.type ?? 'any';

const inputsOf = (plan: Plan | null) => [
  pin('list', { list: itemType(plan) }, { description: 'The items to go through.' }),
  ...(plan?.shared ?? [])
];

const summary = ({ rule }: MapConfig) => `Rule: ${rule}`;

const runEach = async (
  inputs: Values,
  { rule, version, item }: MapConfig,
  ctx: NodeContext,
  visit: (outputs: Values, value: Json) => boolean
) => {
  const { list, ...shared } = inputs;
  for (const [i, value] of (list as Json[]).entries()) {
    const outputs = await ctx.evaluate({ type: rule, version }, { ...shared, [item]: value });
    if (visit(outputs, value)) return i;
  }
  return -1;
};

const KEYWORDS = ['each', 'every', 'item', 'rule', 'list'];

export const eachNodes: NodeDef[] = [
  defineNode<MapConfig>({
    type: 'std.list.map-rule',
    version: 1,
    title: 'Run Rule for Each',
    category: CATEGORY,
    description:
      'Runs a rule once for every item in a list, such as working out the modifiers of each service line, and gives each of its outputs as a list with one value per item.',
    level: 'basic',
    keywords: [...KEYWORDS, 'map', 'transform', 'for each'],
    summary,
    config: mapConfig,
    signature: (c, ctx) => {
      const plan = planOf(c, ctx);
      return {
        execIn: [],
        execOut: [],
        inputs: inputsOf(plan),
        outputs: (plan?.sig.outputs ?? []).map((p) =>
          pin(
            p.name,
            { list: p.type },
            {
              ...(p.label ? { label: p.label } : {}),
              description: `${p.description ?? 'What the rule gives.'} One for each item.`
            }
          )
        )
      };
    },
    run: async ({ config, signature, read, ctx }) => {
      const inputs: Values = {};
      for (const p of signature.inputs) inputs[p.name] = await read(p.name);
      const out: Record<string, Json[]> = Object.fromEntries(
        signature.outputs.map((p) => [p.name, []])
      );
      await runEach(inputs, config, ctx, (outputs) => {
        for (const p of signature.outputs) out[p.name]?.push(outputs[p.name] ?? null);
        return false;
      });
      return next(null, out);
    }
  }),
  pureNode<TestConfig>({
    type: 'std.list.filter-rule',
    title: 'Keep Items Where',
    category: CATEGORY,
    description:
      'Keeps the items of a list for which a rule says true, such as the coverages that still need a claim, and drops the rest.',
    level: 'basic',
    keywords: [...KEYWORDS, 'filter', 'where', 'keep', 'only'],
    summary,
    config: testConfig,
    inputs: (c, ctx) => inputsOf(testedPlan(c, ctx)),
    outputs: (c, ctx) => {
      const type = itemType(testedPlan(c, ctx));
      return [
        pin('list', { list: type }, { description: 'The items the rule kept, in order.' }),
        pin('count', 'integer', { description: 'How many items were kept.' })
      ];
    },
    compute: async (inputs, c, ctx) => {
      const kept: Json[] = [];
      await runEach(inputs, c, ctx, (outputs, value) => {
        if (outputs[c.test] === true) kept.push(value);
        return false;
      });
      return { list: kept, count: kept.length };
    }
  }),
  pureNode<TestConfig>({
    type: 'std.list.find-rule',
    title: 'Find Item Where',
    category: CATEGORY,
    description:
      'Finds the first item of a list for which a rule says true, such as the first coverage that has not answered yet.',
    level: 'basic',
    keywords: [...KEYWORDS, 'find', 'first', 'search', 'match'],
    summary,
    config: testConfig,
    inputs: (c, ctx) => inputsOf(testedPlan(c, ctx)),
    outputs: (c, ctx) => [
      pin('item', itemType(testedPlan(c, ctx)), {
        description: 'The first item the rule said true for, or nothing.'
      }),
      pin('found', 'boolean', { description: 'True when an item was found.' }),
      pin('index', 'integer', {
        description: 'The position of the item, counting from 0, or nothing.'
      })
    ],
    compute: async (inputs, c, ctx) => {
      const index = await runEach(inputs, c, ctx, (outputs) => outputs[c.test] === true);
      return index < 0
        ? { item: null, found: false, index: null }
        : { item: (inputs.list as Json[])[index] ?? null, found: true, index };
    }
  })
];
