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

export type ValueOf<T extends ValueType> = [ValueType] extends [T]
  ? Json
  : T extends 'string' | 'datetime'
    ? string
    : T extends 'number' | 'integer'
      ? number
      : T extends 'boolean'
        ? boolean
        : T extends { list: infer I extends ValueType }
          ? (ValueOf<I> | null)[]
          : T extends { object: infer O extends Record<string, ValueType> }
            ? { [K in keyof O]: ValueOf<O[K]> | null }
            : Json;

export type PinOptions = Omit<PinSpec, 'name' | 'type'>;

export type Pins<C> = readonly PinSpec[] | ((config: C, ctx: SignatureContext) => PinSpec[]);

type PinValue<P extends PinSpec> = P extends { optional: true }
  ? ValueOf<P['type']> | null
  : ValueOf<P['type']>;

export type InputsOf<P> = P extends readonly PinSpec[]
  ? { [S in P[number] as S['name']]: PinValue<S> }
  : Values;

export type OutputsOf<P> = P extends readonly PinSpec[]
  ? { [S in P[number] as S['name']]?: ValueOf<S['type']> | null }
  : Values;

export type NodeMeta<C> = {
  type: string;
  version?: number;
  title: string;
  category: string;
  description: string;
  config?: v.GenericSchema<unknown, C>;
};

type Computed<C, I, R> = {
  inputs: I;
  compute: (inputs: InputsOf<I>, config: C, ctx: NodeContext) => R | Promise<R>;
};

export type ComputeNode<C, I extends Pins<C>, O extends Pins<C>> = NodeMeta<C> &
  Computed<C, I, OutputsOf<O>> & { outputs: O };

export type Exit<E extends string, O> = { exit: E; outputs: O };

export type BranchNode<C, I extends Pins<C>, O extends Pins<C>, E extends string> = NodeMeta<C> &
  Computed<C, I, Exit<E, OutputsOf<O>>> & {
    outputs: O;
    exits: readonly [E, ...E[]];
    effect?: boolean;
  };

export const pin = <
  const N extends string,
  const T extends ValueType,
  const O extends PinOptions = Record<never, never>
>(
  name: N,
  type: T,
  opts?: O
) => ({ name, type, ...opts }) as { name: N; type: T } & NoInfer<O>;

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
  typeof pins === 'function' ? pins(config, ctx) : [...pins];

const metaOf = <C>(m: NodeMeta<C>) => ({
  type: m.type,
  version: m.version ?? 1,
  title: m.title,
  category: m.category,
  description: m.description,
  ...(m.config ? { config: m.config } : {})
});

const computeWith = async <C, I, R>(o: Computed<C, I, R>, inv: Invocation<C>) =>
  o.compute((await readInputs(inv as Invocation<unknown>)) as InputsOf<I>, inv.config, inv.ctx);

export const pureNode = <
  C = unknown,
  const I extends Pins<C> = Pins<C>,
  const O extends Pins<C> = Pins<C>
>(
  o: ComputeNode<C, I, O>
) =>
  defineNode<C>({
    ...metaOf(o),
    signature: (config, ctx) => ({
      execIn: [],
      execOut: [],
      inputs: pinsOf(o.inputs, config, ctx),
      outputs: pinsOf(o.outputs, config, ctx)
    }),
    run: async (inv) => next(null, (await computeWith(o, inv)) as Values)
  });

export const actionNode = <
  C = unknown,
  const I extends Pins<C> = Pins<C>,
  const O extends Pins<C> = Pins<C>
>(
  o: ComputeNode<C, I, O> & { effect?: boolean }
) =>
  defineNode<C>({
    ...metaOf(o),
    ...(o.effect ? { effect: true } : {}),
    signature: (config, ctx) => ({
      execIn: ['exec'],
      execOut: ['then'],
      inputs: pinsOf(o.inputs, config, ctx),
      outputs: pinsOf(o.outputs, config, ctx)
    }),
    run: async (inv) => next('then', (await computeWith(o, inv)) as Values)
  });

export const branchNode = <
  C = unknown,
  const I extends Pins<C> = Pins<C>,
  const O extends Pins<C> = Pins<C>,
  const E extends string = string
>(
  o: BranchNode<C, I, O, E>
) =>
  defineNode<C>({
    ...metaOf(o),
    ...(o.effect ? { effect: true } : {}),
    signature: (config, ctx) => ({
      execIn: ['exec'],
      execOut: [...o.exits],
      inputs: pinsOf(o.inputs, config, ctx),
      outputs: pinsOf(o.outputs, config, ctx)
    }),
    run: async (inv) => {
      const { exit, outputs } = await computeWith(o, inv);
      return next(exit, outputs as Values);
    }
  });
