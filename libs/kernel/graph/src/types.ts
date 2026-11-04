import type * as v from 'valibot';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Values = Record<string, Json>;

export type ValueType =
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | { list: ValueType }
  | { object: Record<string, ValueType> };

export type PinSpec = {
  name: string;
  type: ValueType;
  label?: string;
  optional?: boolean;
  default?: Json;
};

export type Signature = {
  execIn: string[];
  execOut: string[];
  inputs: PinSpec[];
  outputs: PinSpec[];
};

export type NodeRef = {
  type: string;
  version: number;
};

export type InputBinding = { value: Json } | { expr: string };

export type RetryPolicy = {
  max: number;
  delayMs: number;
  factor?: number;
};

export type NodeInstance = NodeRef & {
  id: string;
  label?: string;
  config?: Json;
  inputs?: Record<string, InputBinding>;
  retry?: RetryPolicy;
  position?: { x: number; y: number };
};

export type Edge = {
  from: string;
  fromPin: string;
  to: string;
  toPin: string;
};

export type VariableDef = {
  name: string;
  type: ValueType;
  default: Json;
};

export type GraphDef = {
  signature: Signature;
  variables: VariableDef[];
  nodes: NodeInstance[];
  edges: Edge[];
};

export type GraphSource = (ref: NodeRef) => GraphDef | undefined;

export type ErrorInfo = {
  message: string;
  path: string;
  node: string;
};

export type NodeEvent =
  | { type: 'exec'; pin: string }
  | { type: 'eval' }
  | { type: 'return' }
  | { type: 'resume'; payload: Json }
  | { type: 'error'; error: ErrorInfo };

export type Suspension = {
  kind: string;
  data: Json;
};

export type NodeResult = { outputs: Values; state?: Json } & (
  | { type: 'next'; pin: string | null }
  | { type: 'call'; pin: string }
  | { type: 'suspend'; suspension: Suspension }
);

export type NodeContext = {
  runId: string;
  key: string;
  now: Date;
  signal?: AbortSignal;
};

export type VarAccess = {
  get: (name: string) => Json;
  set: (name: string, value: Json) => void;
};

export type Invocation<C = unknown> = {
  config: C;
  event: NodeEvent;
  state: Json;
  signature: Signature;
  read: (pin: string) => Promise<Json>;
  vars: VarAccess;
  ctx: NodeContext;
};

export type SignatureContext = {
  graph: GraphDef;
};

export type NodeDef<C = unknown> = NodeRef & {
  title: string;
  category: string;
  description: string;
  config?: v.GenericSchema<unknown, C>;
  signature: Signature | ((config: C, ctx: SignatureContext) => Signature);
  effect?: boolean;
  catches?: boolean;
  calls?: (config: C) => string[];
  variables?: (config: C) => string[];
  run: (inv: Invocation<C>) => NodeResult | Promise<NodeResult>;
};

export type Cursor = {
  scope: string;
  node: string;
  event: NodeEvent;
};

export type Frame =
  | { kind: 'call'; scope: string; node: string }
  | { kind: 'graph'; scope: string };

export type Scope = {
  id: string;
  graph: NodeRef;
  path: string;
  parent: string | null;
  node: string | null;
  inputs: Values;
  vars: Values;
  outputs: Record<string, Values>;
  states: Record<string, Json>;
  counts: Record<string, number>;
  attempts: Record<string, number>;
  startedAt: string;
};

export type RunStatus = 'running' | 'suspended' | 'completed' | 'faulted';

type PendingSuspension = Suspension & {
  id: string;
  cursor: Cursor;
  retry: boolean;
};

export type RunState = {
  status: RunStatus;
  root: NodeRef;
  seq: number;
  scopes: Record<string, Scope>;
  stack: Frame[];
  cursor: Cursor | null;
  suspension: PendingSuspension | null;
  fault: { cursor: Cursor; error: ErrorInfo } | null;
  result: { pin: string | null; outputs: Values } | null;
};

export type TraceEntry = {
  seq: number;
  scope: string;
  path: string;
  node: string;
  type: string;
  version: number;
  event: NodeEvent['type'];
  inputs: Values;
  outputs: Values;
  pin: string | null;
  error: ErrorInfo | null;
  startedAt: string;
  durationMs: number;
};
