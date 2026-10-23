import type * as v from 'valibot';
import type {
  Invocation,
  Json,
  NodeContext,
  NodeDef,
  NodeResult,
  PinSpec,
  SignatureContext,
  Suspension,
  Values,
  ValueType
} from './types.ts';

export type Pins<C> = PinSpec[] | ((config: C, ctx: SignatureContext) => PinSpec[]);

export type NodeMeta<C> = {
  type: string;
  version?: number;
  title: string;
  category: string;
  description: string;
  config?: v.GenericSchema<unknown, C>;
};

export type ComputeNode<C> = NodeMeta<C> & {
  inputs: Pins<C>;
  outputs: Pins<C>;
  compute: (inputs: Values, config: C, ctx: NodeContext) => Values | Promise<Values>;
};

export const pin = (
  name: string,
  type: ValueType,
  opts: Omit<PinSpec, 'name' | 'type'> = {}
): PinSpec => ({ name, type, ...opts });

export const next = (pin: string | null, outputs: Values = {}, state?: Json): NodeResult => ({
  type: 'next',
  pin,
  outputs,
  ...(state === undefined ? {} : { state })
});

export const call = (pin: string, state: Json, outputs: Values = {}): NodeResult => ({
  type: 'call',
  pin,
  state,
  outputs
});

export const suspend = (
  suspension: Suspension,
  state: Json = null,
  outputs: Values = {}
): NodeResult => ({
  type: 'suspend',
  suspension,
  state,
  outputs
});

export const defineNode = <C>(def: NodeDef<C>): NodeDef => def as unknown as NodeDef;

export const readInputs = async (inv: Invocation<unknown>): Promise<Values> => {
  const out: Values = {};
  for (const p of inv.signature.inputs) out[p.name] = await inv.read(p.name);
  return out;
};

const pinsOf = <C>(pins: Pins<C>, config: C, ctx: SignatureContext) =>
  typeof pins === 'function' ? pins(config, ctx) : pins;

const metaOf = <C>(m: NodeMeta<C>) => ({
  type: m.type,
  version: m.version ?? 1,
  title: m.title,
  category: m.category,
  description: m.description,
  ...(m.config ? { config: m.config } : {})
});

export const pureNode = <C = unknown>(o: ComputeNode<C>) =>
  defineNode<C>({
    ...metaOf(o),
    signature: (config, ctx) => ({
      execIn: [],
      execOut: [],
      inputs: pinsOf(o.inputs, config, ctx),
      outputs: pinsOf(o.outputs, config, ctx)
    }),
    run: async (inv) => next(null, await o.compute(await readInputs(inv), inv.config, inv.ctx))
  });

export const actionNode = <C = unknown>(o: ComputeNode<C> & { effect?: boolean }) =>
  defineNode<C>({
    ...metaOf(o),
    ...(o.effect ? { effect: true } : {}),
    signature: (config, ctx) => ({
      execIn: ['exec'],
      execOut: ['then'],
      inputs: pinsOf(o.inputs, config, ctx),
      outputs: pinsOf(o.outputs, config, ctx)
    }),
    run: async (inv) => next('then', await o.compute(await readInputs(inv), inv.config, inv.ctx))
  });
