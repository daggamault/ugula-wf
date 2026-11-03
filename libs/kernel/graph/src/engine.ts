import { checkExit, checkInput, checkOutputs } from './checks.ts';
import {
  type CompiledGraph,
  ENTRY_TYPE,
  INPUT_TYPE,
  portKey,
  RETURN_TYPE,
  refKey
} from './compile.ts';
import { fail, messageOf } from './errors.ts';
import { evaluateExpr } from './expr.ts';
import { createRegistry, isPure, type Registry } from './registry.ts';
import { MAX_RETRY_DELAY_MS } from './schemas.ts';
import type {
  Cursor,
  ErrorInfo,
  Frame,
  GraphSource,
  Json,
  NodeDef,
  NodeEvent,
  NodeInstance,
  NodeRef,
  NodeResult,
  RetryPolicy,
  RunState,
  Scope,
  Signature,
  TraceEntry,
  Values,
  VarAccess
} from './types.ts';
import { checkValue } from './value-types.ts';

export type EngineOptions = {
  nodes: NodeDef[];
  graphs: GraphSource;
  maxDepth?: number;
  isTransient?: (err: unknown) => boolean;
  deferOf?: (err: unknown) => number | null;
  transientRetry?: RetryPolicy;
};

const TRANSIENT_RETRY: RetryPolicy = { max: 5, delayMs: 5_000, factor: 3 };

export type StepContext = {
  runId: string;
  now: Date;
  signal?: AbortSignal;
};

export type StepResult = {
  trace: TraceEntry[];
  checkpoint: boolean;
};

export type StartOptions = {
  now: Date;
  entry?: string;
};

export type NodeAtCursor = {
  instance: NodeInstance;
  title: string;
  signature: Signature;
  exits: string[];
};

export type Engine = {
  registry: Registry;
  start: (ref: NodeRef, inputs: Values, opts: StartOptions) => RunState;
  advance: (state: RunState, cx: StepContext) => Promise<StepResult>;
  drain: (state: RunState, cx: StepContext, maxSteps?: number) => Promise<TraceEntry[]>;
  resume: (state: RunState, suspensionId: string, payload: Json) => void;
  retryFault: (state: RunState) => void;
  skipFault: (state: RunState, pin: string | null, outputs: Values) => void;
  nodeAt: (state: RunState, cursor: Cursor) => NodeAtCursor | null;
};

type Cached = { outputs: Values; stamps: Map<string, number>; now: number | null };

type Cache = { tick: number; stamps: Map<string, number>; entries: Map<string, Cached> };

type Session = StepContext & { state: RunState; trace: TraceEntry[]; cache: Cache };

type Memo = { done: Map<string, Cached>; active: Set<string> };

type Deps = { stamps: Map<string, number>; now: boolean };

type Reader = { read: (pin: string) => Promise<Json>; values: Values };

const origins = new WeakMap<object, ErrorInfo>();

const labelOf = (inst: NodeInstance) => inst.label ?? inst.id;

const originOf = (err: unknown) =>
  typeof err === 'object' && err !== null ? origins.get(err) : undefined;

const locate = (err: unknown, scope: Scope, node: string) => {
  if (typeof err === 'object' && err !== null && !origins.has(err)) {
    origins.set(err, { message: messageOf(err), path: scope.path, node });
  }
};

const newMemo = (): Memo => ({ done: new Map(), active: new Set() });

const newDeps = (): Deps => ({ stamps: new Map(), now: false });

const caches = new WeakMap<RunState, Cache>();

const cacheOf = (state: RunState) => {
  const hit = caches.get(state);
  if (hit) return hit;
  const cache: Cache = { tick: 0, stamps: new Map(), entries: new Map() };
  caches.set(state, cache);
  return cache;
};

const outKey = (scope: string, node: string) => `${scope}/${node}`;

const varsKey = (scope: string) => `${scope}#vars`;

const touch = (cache: Cache, key: string) => {
  cache.stamps.set(key, ++cache.tick);
};

const depend = (cache: Cache, deps: Deps, key: string) => {
  deps.stamps.set(key, cache.stamps.get(key) ?? 0);
};

const fresh = (cache: Cache, hit: Cached, now: Date) =>
  (hit.now === null || hit.now === now.getTime()) &&
  [...hit.stamps].every(([k, v]) => (cache.stamps.get(k) ?? 0) === v);

const depthOf = (scope: Scope) => scope.path.split('/').length - 1;

const signalOf = ({ signal }: StepContext) => (signal ? { signal } : {});

export const createEngine = ({
  nodes,
  graphs,
  maxDepth = 256,
  isTransient = () => false,
  deferOf = () => null,
  transientRetry = TRANSIENT_RETRY
}: EngineOptions): Engine => {
  const registry = createRegistry(nodes, graphs);

  const graphOf = (ref: NodeRef) => registry.graph(ref) ?? fail(`Unknown graph ${refKey(ref)}`);
  const scopeOf = (state: RunState, id: string) => state.scopes[id] ?? fail(`Unknown scope ${id}`);
  const nodeIn = (g: CompiledGraph, id: string) => g.nodes.get(id) ?? fail(`Unknown node ${id}`);
  const nextSeq = (state: RunState) => ++state.seq;

  const follow = (
    g: CompiledGraph,
    scope: string,
    node: string | undefined,
    pin: string | null
  ): Cursor | null => {
    if (node === undefined || pin === null) return null;
    const e = g.out.get(portKey(node, pin))?.[0];
    return e ? { scope, node: e.to, event: { type: 'exec', pin: e.toPin } } : null;
  };

  const openScope = (
    { state, now }: Pick<Session, 'state' | 'now'>,
    ref: NodeRef,
    g: CompiledGraph,
    parent: Scope | null,
    node: string | null,
    inputs: Values
  ): Scope => ({
    id: `s${nextSeq(state)}`,
    graph: { type: ref.type, version: ref.version },
    path: parent ? `${parent.path}${node}/` : '',
    parent: parent?.id ?? null,
    node,
    inputs,
    vars: Object.fromEntries(g.def.variables.map((v) => [v.name, structuredClone(v.default)])),
    outputs: {},
    states: {},
    counts: {},
    attempts: {},
    startedAt: now.toISOString()
  });

  const record = (
    s: Session,
    scope: Scope,
    inst: NodeInstance,
    entry: Omit<TraceEntry, 'seq' | 'scope' | 'path' | 'node' | 'type' | 'version'>
  ) => {
    s.trace.push({
      seq: nextSeq(s.state),
      scope: scope.id,
      path: scope.path,
      node: inst.id,
      type: inst.type,
      version: inst.version,
      ...entry
    });
  };

  const traced = (
    s: Session,
    scope: Scope,
    inst: NodeInstance,
    err: unknown,
    event: NodeEvent,
    inputs: Values,
    t0: number
  ) => {
    locate(err, scope, inst.id);
    if (deferOf(err) !== null) return err;
    record(s, scope, inst, {
      event: event.type,
      inputs,
      outputs: {},
      pin: null,
      error: originOf(err) ?? { message: messageOf(err), path: scope.path, node: inst.id },
      startedAt: s.now.toISOString(),
      durationMs: performance.now() - t0
    });
    return err;
  };

  const varAccess = (s: Session, g: CompiledGraph, scope: Scope, deps: Deps): VarAccess => ({
    get: (name) => {
      if (!g.variables.has(name)) fail(`Unknown variable "${name}"`);
      depend(s.cache, deps, varsKey(scope.id));
      return scope.vars[name] ?? null;
    },
    set: (name, value) => {
      const def = g.variables.get(name) ?? fail(`Unknown variable "${name}"`);
      const err = checkValue(def.type, value);
      if (err) fail(`Variable "${name}": ${err}`);
      scope.vars[name] = value;
      touch(s.cache, varsKey(scope.id));
    }
  });

  const reader = (
    s: Session,
    scope: Scope,
    g: CompiledGraph,
    inst: NodeInstance,
    sig: Signature,
    memo: Memo,
    deps: Deps = newDeps()
  ): Reader => {
    const values: Values = {};
    const read = async (name: string): Promise<Json> => {
      if (Object.hasOwn(values, name)) return values[name] ?? null;
      const spec =
        sig.inputs.find((p) => p.name === name) ??
        fail(`"${labelOf(inst)}" has no input "${name}"`);
      const edge = g.in.get(portKey(inst.id, name))?.[0];
      const binding = inst.inputs?.[name];
      if (!edge && binding && 'expr' in binding) {
        depend(s.cache, deps, varsKey(scope.id));
        deps.now = true;
      }
      const raw = edge
        ? await pull(s, scope, g, edge.from, edge.fromPin, memo, deps)
        : binding
          ? 'expr' in binding
            ? evaluateExpr(binding.expr, scope.vars, { now: s.now })
            : binding.value
          : (spec.default ?? null);
      const value = checkInput(labelOf(inst), spec, raw);
      values[name] = value;
      return value;
    };
    return { read, values };
  };

  const readAll = async (r: Reader, sig: Signature) => {
    for (const p of sig.inputs) await r.read(p.name);
    return r.values;
  };

  const pull = async (
    s: Session,
    scope: Scope,
    g: CompiledGraph,
    id: string,
    pin: string,
    memo: Memo,
    deps: Deps
  ): Promise<Json> => {
    const src = nodeIn(g, id);
    if (src.type === ENTRY_TYPE || src.type === INPUT_TYPE) return scope.inputs[pin] ?? null;
    const sig = registry.signature(src, g.def);
    const key = outKey(scope.id, id);
    if (!isPure(sig)) {
      depend(s.cache, deps, key);
      const out = scope.outputs[id];
      return out && Object.hasOwn(out, pin)
        ? (out[pin] ?? null)
        : fail(`"${labelOf(src)}" has not produced "${pin}" yet`);
    }
    const kept = s.state.scopes[scope.id] === scope;
    const hit = kept ? s.cache.entries.get(key) : undefined;
    let found = memo.done.get(key) ?? (hit && fresh(s.cache, hit, s.now) ? hit : undefined);
    if (!found) {
      if (memo.active.has(key)) fail(`Data cycle through "${labelOf(src)}"`);
      memo.active.add(key);
      const own = newDeps();
      try {
        const outputs = await evalPure(s, scope, g, src, sig, memo, own);
        found = { outputs, stamps: own.stamps, now: own.now ? s.now.getTime() : null };
      } finally {
        memo.active.delete(key);
      }
      memo.done.set(key, found);
      if (kept) s.cache.entries.set(key, found);
    }
    for (const [k, v] of found.stamps) deps.stamps.set(k, v);
    if (found.now !== null) deps.now = true;
    return found.outputs[pin] ?? null;
  };

  const evalPure = async (
    s: Session,
    scope: Scope,
    g: CompiledGraph,
    inst: NodeInstance,
    sig: Signature,
    memo: Memo,
    deps: Deps
  ): Promise<Values> => {
    const t0 = performance.now();
    const r = reader(s, scope, g, inst, sig, memo, deps);
    try {
      const sub = registry.graph(inst);
      let outputs: Values;
      if (sub) {
        const ret = sub.returns[0] ?? fail(`Graph ${refKey(inst)} has no Return node`);
        if (depthOf(scope) >= maxDepth) {
          fail(`Maximum call depth of ${maxDepth} exceeded`);
        }
        const child = openScope(s, inst, sub, scope, inst.id, await readAll(r, sig));
        const retSig = registry.signature(ret, sub.def);
        outputs = { ...(await readAll(reader(s, child, sub, ret, retSig, memo, deps), retSig)) };
      } else {
        const def = registry.node(inst) ?? fail(`Unknown node type ${refKey(inst)}`);
        const res = await def.run({
          config: registry.config(inst),
          event: { type: 'eval' },
          state: null,
          signature: sig,
          read: r.read,
          vars: varAccess(s, g, scope, deps),
          ctx: {
            runId: s.runId,
            key: `${s.runId}:${scope.id}:${inst.id}`,
            get now() {
              deps.now = true;
              return s.now;
            },
            ...signalOf(s)
          }
        });
        if (res.type !== 'next') fail(`Pure node "${labelOf(inst)}" cannot ${res.type}`);
        checkOutputs(labelOf(inst), sig, res.outputs);
        outputs = res.outputs;
      }
      record(s, scope, inst, {
        event: 'eval',
        inputs: {},
        outputs,
        pin: null,
        error: null,
        startedAt: s.now.toISOString(),
        durationMs: performance.now() - t0
      });
      return outputs;
    } catch (err) {
      if (!originOf(err)) traced(s, scope, inst, err, { type: 'eval' }, r.values, t0);
      throw err;
    }
  };

  const complete = (s: Session, scope: Scope, pin: string | null, outputs: Values) => {
    const { state } = s;
    while (state.stack.length) {
      const f = state.stack.pop();
      if (f?.kind === 'graph' && f.scope === scope.id) break;
    }
    delete state.scopes[scope.id];
    const parent = scope.parent === null ? undefined : state.scopes[scope.parent];
    if (!parent || scope.node === null) {
      state.status = 'completed';
      state.result = { pin, outputs };
      state.cursor = null;
      return;
    }
    const pg = graphOf(parent.graph);
    const inst = nodeIn(pg, scope.node);
    parent.outputs[inst.id] = outputs;
    touch(s.cache, outKey(parent.id, inst.id));
    delete parent.attempts[inst.id];
    record(s, parent, inst, {
      event: 'exec',
      inputs: scope.inputs,
      outputs,
      pin,
      error: null,
      startedAt: scope.startedAt,
      durationMs: s.now.getTime() - Date.parse(scope.startedAt)
    });
    state.cursor = follow(pg, parent.id, inst.id, pin);
  };

  const chainEnd = (s: Session) => {
    const { state } = s;
    const f = state.stack.at(-1);
    if (!f) {
      state.status = 'completed';
      state.result ??= { pin: null, outputs: {} };
      return;
    }
    if (f.kind === 'call') {
      state.stack.pop();
      state.cursor = { scope: f.scope, node: f.node, event: { type: 'return' } };
      return;
    }
    const scope = scopeOf(state, f.scope);
    const sig = graphOf(scope.graph).def.signature;
    if (
      scope.parent !== null &&
      scope.node !== null &&
      (sig.execOut.length || sig.outputs.length)
    ) {
      unreturned(s, scope, scope.parent, scope.node, sig.execIn[0] ?? 'exec');
      return;
    }
    const defaults = Object.fromEntries(sig.outputs.map((p) => [p.name, p.default ?? null]));
    complete(s, scope, sig.execOut[0] ?? null, defaults);
  };

  const unreturned = (s: Session, scope: Scope, parentId: string, node: string, pin: string) => {
    const { state } = s;
    state.stack.pop();
    delete state.scopes[scope.id];
    const parent = scopeOf(state, parentId);
    const inst = nodeIn(graphOf(parent.graph), node);
    const event: NodeEvent = { type: 'exec', pin };
    const err = new Error(`"${labelOf(inst)}" ended without reaching a Return node`);
    traced(s, parent, inst, err, event, scope.inputs, performance.now());
    handleError(s, { scope: parent.id, node, event }, err);
  };

  const pushFrame = (state: RunState, frame: Frame) => {
    if (state.stack.length >= maxDepth) fail(`Maximum call depth of ${maxDepth} exceeded`);
    state.stack.push(frame);
  };

  const returnFrom = async (s: Session, scope: Scope, g: CompiledGraph, inst: NodeInstance) => {
    const t0 = performance.now();
    const r = reader(s, scope, g, inst, registry.signature(inst, g.def), newMemo());
    try {
      await readAll(r, registry.signature(inst, g.def));
    } catch (err) {
      throw traced(s, scope, inst, err, { type: 'exec', pin: 'exec' }, r.values, t0);
    }
    const { pin } = registry.config(inst) as { pin?: string };
    record(s, scope, inst, {
      event: 'exec',
      inputs: r.values,
      outputs: {},
      pin: null,
      error: null,
      startedAt: s.now.toISOString(),
      durationMs: performance.now() - t0
    });
    complete(s, scope, pin ?? g.def.signature.execOut[0] ?? null, { ...r.values });
  };

  const enter = async (
    s: Session,
    scope: Scope,
    g: CompiledGraph,
    inst: NodeInstance,
    sub: CompiledGraph,
    event: NodeEvent
  ) => {
    if (event.type !== 'exec') return fail(`"${labelOf(inst)}" cannot handle ${event.type}`);
    const t0 = performance.now();
    const sig = sub.def.signature;
    const r = reader(s, scope, g, inst, sig, newMemo());
    try {
      await readAll(r, sig);
    } catch (err) {
      throw traced(s, scope, inst, err, event, r.values, t0);
    }
    const child = openScope(s, inst, sub, scope, inst.id, r.values);
    pushFrame(s.state, { kind: 'graph', scope: child.id });
    s.state.scopes[child.id] = child;
    s.state.cursor = follow(sub, child.id, sub.entry?.id, event.pin);
  };

  const invoke = async (
    s: Session,
    scope: Scope,
    g: CompiledGraph,
    inst: NodeInstance,
    event: NodeEvent
  ) => {
    const { state } = s;
    const def = registry.node(inst) ?? fail(`Unknown node type ${refKey(inst)}`);
    const sig = registry.signature(inst, g.def);
    if (isPure(sig)) fail(`Pure node "${labelOf(inst)}" cannot be executed`);
    if (event.type === 'exec' && scope.attempts[inst.id] === undefined) {
      scope.counts[inst.id] = (scope.counts[inst.id] ?? 0) + 1;
    }
    const t0 = performance.now();
    const r = reader(s, scope, g, inst, sig, newMemo());
    let res: NodeResult;
    try {
      res = await def.run({
        config: registry.config(inst),
        event,
        state: scope.states[inst.id] ?? null,
        signature: sig,
        read: r.read,
        vars: varAccess(s, g, scope, newDeps()),
        ctx: {
          runId: s.runId,
          key: `${s.runId}:${scope.id}:${inst.id}:${scope.counts[inst.id] ?? 0}`,
          now: s.now,
          ...signalOf(s)
        }
      });
      checkOutputs(labelOf(inst), sig, res.outputs);
      checkExit(labelOf(inst), sig, res);
    } catch (err) {
      throw traced(s, scope, inst, err, event, r.values, t0);
    }
    if (res.type !== 'suspend') delete scope.attempts[inst.id];
    const first = event.type === 'exec' && scope.states[inst.id] == null;
    scope.outputs[inst.id] = first ? res.outputs : { ...scope.outputs[inst.id], ...res.outputs };
    touch(s.cache, outKey(scope.id, inst.id));
    if (res.state !== undefined) scope.states[inst.id] = res.state;
    record(s, scope, inst, {
      event: event.type,
      inputs: r.values,
      outputs: res.outputs,
      pin: res.type === 'suspend' ? null : res.pin,
      error: null,
      startedAt: s.now.toISOString(),
      durationMs: performance.now() - t0
    });
    if (res.type === 'next') {
      state.cursor = follow(g, scope.id, inst.id, res.pin);
    } else if (res.type === 'call') {
      pushFrame(state, { kind: 'call', scope: scope.id, node: inst.id });
      state.cursor = follow(g, scope.id, inst.id, res.pin);
    } else {
      state.status = 'suspended';
      state.suspension = {
        ...res.suspension,
        id: String(nextSeq(state)),
        cursor: { scope: scope.id, node: inst.id, event: { type: 'resume', payload: null } },
        retry: false
      };
    }
    return def.effect === true;
  };

  const execute = async (s: Session, cursor: Cursor) => {
    const { state } = s;
    const scope = scopeOf(state, cursor.scope);
    const g = graphOf(scope.graph);
    const inst = nodeIn(g, cursor.node);
    if (cursor.event.type === 'exec') {
      const i = state.stack.findLastIndex(
        (f) => f.kind === 'call' && f.scope === scope.id && f.node === inst.id
      );
      if (i >= 0) state.stack.length = i;
    }
    if (inst.type === RETURN_TYPE) {
      await returnFrom(s, scope, g, inst);
      return false;
    }
    const sub = registry.graph(inst);
    if (sub) {
      await enter(s, scope, g, inst, sub, cursor.event);
      return false;
    }
    return invoke(s, scope, g, inst, cursor.event);
  };

  const catches = (state: RunState, f: Frame) => {
    if (f.kind !== 'call') return false;
    const scope = state.scopes[f.scope];
    const inst = scope ? registry.graph(scope.graph)?.nodes.get(f.node) : undefined;
    return inst ? registry.node(inst)?.catches === true : false;
  };

  const restartOf = (state: RunState, cursor: Cursor): Cursor => {
    if (cursor.event.type !== 'resume') return cursor;
    const scope = scopeOf(state, cursor.scope);
    const g = graphOf(scope.graph);
    const inst = nodeIn(g, cursor.node);
    delete scope.states[inst.id];
    const pin = registry.signature(inst, g.def).execIn[0] ?? 'exec';
    return { ...cursor, event: { type: 'exec', pin } };
  };

  const handleError = (s: Session, cursor: Cursor, err: unknown) => {
    const { state } = s;
    const scope = state.scopes[cursor.scope];
    const inst = scope ? registry.graph(scope.graph)?.nodes.get(cursor.node) : undefined;
    const error = originOf(err) ?? {
      message: messageOf(err),
      path: scope?.path ?? '',
      node: cursor.node
    };
    const deferMs = scope && inst ? deferOf(err) : null;
    if (scope && inst && deferMs !== null) {
      scope.attempts[inst.id] ??= 0;
      state.status = 'suspended';
      state.suspension = {
        id: String(nextSeq(state)),
        kind: 'timer',
        data: {
          until: new Date(s.now.getTime() + Math.min(deferMs, MAX_RETRY_DELAY_MS)).toISOString(),
          deferred: error.message
        },
        cursor: restartOf(state, cursor),
        retry: true
      };
      return;
    }
    if (scope && inst) {
      const attempt = (scope.attempts[inst.id] ?? 0) + 1;
      scope.attempts[inst.id] = attempt;
      const policy = inst.retry ?? (isTransient(err) ? transientRetry : undefined);
      if (policy && attempt <= policy.max) {
        const delay = Math.min(
          policy.delayMs * (policy.factor ?? 1) ** (attempt - 1),
          MAX_RETRY_DELAY_MS
        );
        state.status = 'suspended';
        state.suspension = {
          id: String(nextSeq(state)),
          kind: 'timer',
          data: {
            until: new Date(s.now.getTime() + delay).toISOString(),
            attempt,
            error: error.message
          },
          cursor: restartOf(state, cursor),
          retry: true
        };
        return;
      }
    }
    const i = state.stack.findLastIndex((f) => catches(state, f));
    const catcher = state.stack[i];
    if (catcher?.kind === 'call') {
      for (const dropped of state.stack.splice(i)) {
        if (dropped.kind === 'graph') delete state.scopes[dropped.scope];
      }
      if (scope && inst) delete scope.attempts[inst.id];
      state.cursor = { scope: catcher.scope, node: catcher.node, event: { type: 'error', error } };
      return;
    }
    state.status = 'faulted';
    state.fault = { cursor, error };
  };

  const start = (ref: NodeRef, inputs: Values, { now, entry }: StartOptions): RunState => {
    const g = graphOf(ref);
    const sig = g.def.signature;
    const pin = entry ?? sig.execIn[0];
    if (pin === undefined || !sig.execIn.includes(pin)) {
      throw new Error(`Graph ${refKey(ref)} has no exec input "${pin ?? ''}"`);
    }
    for (const name of Object.keys(inputs)) {
      if (!sig.inputs.some((p) => p.name === name)) {
        fail(`Graph ${refKey(ref)} has no input "${name}"`);
      }
    }
    const state: RunState = {
      status: 'running',
      root: { type: ref.type, version: ref.version },
      seq: 0,
      scopes: {},
      stack: [],
      cursor: null,
      suspension: null,
      fault: null,
      result: null
    };
    const values = Object.fromEntries(
      sig.inputs.map((p) => [
        p.name,
        checkInput(refKey(ref), p, inputs[p.name] ?? p.default ?? null)
      ])
    );
    const root = openScope({ state, now }, ref, g, null, null, values);
    state.scopes[root.id] = root;
    state.stack.push({ kind: 'graph', scope: root.id });
    state.cursor = follow(g, root.id, g.entry?.id, pin);
    return state;
  };

  const advance = async (state: RunState, cx: StepContext): Promise<StepResult> => {
    if (state.status !== 'running') throw new Error(`Run is ${state.status}`);
    cx.signal?.throwIfAborted();
    const s: Session = { ...cx, state, trace: [], cache: cacheOf(state) };
    const cursor = state.cursor;
    state.cursor = null;
    let effect = false;
    if (!cursor) chainEnd(s);
    else {
      try {
        effect = await execute(s, cursor);
      } catch (err) {
        handleError(s, cursor, err);
      }
    }
    return { trace: s.trace, checkpoint: effect || state.status !== 'running' };
  };

  const drain = async (state: RunState, cx: StepContext, maxSteps = 100_000) => {
    const trace: TraceEntry[] = [];
    for (let i = 0; state.status === 'running'; i++) {
      if (i >= maxSteps) throw new Error(`Run exceeded ${maxSteps} steps`);
      trace.push(...(await advance(state, cx)).trace);
    }
    return trace;
  };

  const resume = (state: RunState, suspensionId: string, payload: Json) => {
    const sus = state.status === 'suspended' ? state.suspension : null;
    if (!sus || sus.id !== suspensionId) {
      throw new Error(`Run is not waiting on suspension ${suspensionId}`);
    }
    state.cursor = sus.retry ? sus.cursor : { ...sus.cursor, event: { type: 'resume', payload } };
    state.status = 'running';
    state.suspension = null;
  };

  const callPins = (inst: NodeInstance) =>
    registry.node(inst)?.calls?.(registry.config(inst)) ?? [];

  const nodeAt = (state: RunState, cursor: Cursor): NodeAtCursor | null => {
    const scope = state.scopes[cursor.scope];
    const g = scope ? registry.graph(scope.graph) : undefined;
    const instance = g?.nodes.get(cursor.node);
    if (!g || !instance) return null;
    const signature = registry.signature(instance, g.def);
    const calls = callPins(instance);
    return {
      instance,
      title: instance.label ?? registry.node(instance)?.title ?? instance.type,
      signature,
      exits: signature.execOut.filter((p) => !calls.includes(p))
    };
  };

  const faultOf = (state: RunState) => {
    if (state.status !== 'faulted' || !state.fault) throw new Error('Run is not faulted');
    return state.fault;
  };

  const retryFault = (state: RunState) => {
    const { cursor } = faultOf(state);
    const scope = state.scopes[cursor.scope];
    if (scope && scope.attempts[cursor.node] !== undefined) scope.attempts[cursor.node] = 0;
    state.cursor = restartOf(state, cursor);
    state.status = 'running';
    state.fault = null;
  };

  const skipFault = (state: RunState, pin: string | null, outputs: Values) => {
    const { cursor } = faultOf(state);
    const scope = scopeOf(state, cursor.scope);
    const g = graphOf(scope.graph);
    const inst = nodeIn(g, cursor.node);
    if (inst.type === RETURN_TYPE) throw new Error('A Return node cannot be skipped');
    const sig = registry.signature(inst, g.def);
    if (pin !== null && !sig.execOut.includes(pin)) {
      throw new Error(`"${labelOf(inst)}" has no exec output "${pin}"`);
    }
    if (pin !== null && callPins(inst).includes(pin)) {
      throw new Error(`"${labelOf(inst)}" cannot be skipped into "${pin}"`);
    }
    checkOutputs(labelOf(inst), sig, outputs);
    scope.outputs[inst.id] = { ...scope.outputs[inst.id], ...outputs };
    touch(cacheOf(state), outKey(scope.id, inst.id));
    delete scope.attempts[inst.id];
    state.cursor = follow(g, scope.id, inst.id, pin);
    state.status = 'running';
    state.fault = null;
  };

  return { registry, start, advance, drain, resume, retryFault, skipFault, nodeAt };
};
