import * as v from 'valibot';
import { call, defineNode, next, pin, suspend } from '../define.ts';
import { fail } from '../errors.ts';
import { isRecord, toText } from '../json.ts';
import type { Json, NodeDef } from '../types.ts';

const CATEGORY = 'Flow';

const loopState = (state: Json) => (isRecord(state) ? state : {});

const isBreak = (event: { type: string; pin?: string }) =>
  event.type === 'exec' && event.pin === 'break';

const workflowConfig = v.object({
  workflow: v.pipe(v.string(), v.nonEmpty()),
  version: v.pipe(v.number(), v.integer(), v.minValue(1))
});

const childError = (payload: Json) =>
  isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;

export const branchNode = defineNode({
  type: 'std.flow.branch',
  version: 1,
  title: 'Branch',
  category: CATEGORY,
  description: 'Continues through true or false depending on the condition.',
  signature: {
    execIn: ['exec'],
    execOut: ['true', 'false'],
    inputs: [pin('condition', 'boolean')],
    outputs: []
  },
  run: async ({ read }) => next((await read('condition')) ? 'true' : 'false')
});

const switchConfig = v.object({
  cases: v.pipe(
    v.array(v.pipe(v.string(), v.nonEmpty())),
    v.minLength(1),
    v.check(
      (xs) => new Set(xs).size === xs.length && !xs.includes('default'),
      'Cases must be unique'
    )
  )
});

export const switchNode = defineNode<v.InferOutput<typeof switchConfig>>({
  type: 'std.flow.switch',
  version: 1,
  title: 'Switch',
  category: CATEGORY,
  description: 'Continues through the exec output matching the value, or default.',
  config: switchConfig,
  signature: ({ cases }) => ({
    execIn: ['exec'],
    execOut: [...cases, 'default'],
    inputs: [pin('value', 'any', { optional: true })],
    outputs: []
  }),
  run: async ({ read, config }) => {
    const value = toText(await read('value'));
    return next(config.cases.includes(value) ? value : 'default');
  }
});

const sequenceConfig = v.object({
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32)), 2)
});

export const sequenceNode = defineNode<v.InferOutput<typeof sequenceConfig>>({
  type: 'std.flow.sequence',
  version: 1,
  title: 'Sequence',
  category: CATEGORY,
  description: 'Runs each exec output in order, each to completion.',
  config: sequenceConfig,
  calls: ({ count }) => Array.from({ length: count }, (_, i) => `then${i}`),
  signature: ({ count }) => ({
    execIn: ['exec'],
    execOut: Array.from({ length: count }, (_, i) => `then${i}`),
    inputs: [],
    outputs: []
  }),
  run: ({ event, state, config }) => {
    const index = event.type === 'return' ? Number(loopState(state).index) + 1 : 0;
    return index < config.count ? call(`then${index}`, { index }) : next(null, {}, null);
  }
});

export const forEachNode = defineNode({
  type: 'std.flow.for-each',
  version: 1,
  title: 'For Each',
  category: CATEGORY,
  description: 'Runs the body once per list item, then continues through completed.',
  calls: () => ['body'],
  signature: {
    execIn: ['exec', 'break'],
    execOut: ['body', 'completed'],
    inputs: [pin('list', { list: 'any' })],
    outputs: [pin('item', 'any'), pin('index', 'integer')]
  },
  run: async ({ event, state, read }) => {
    if (isBreak(event)) return next('completed', {}, null);
    const loop = event.type === 'return' ? loopState(state) : null;
    const items = (loop ? loop.items : await read('list')) as Json[];
    const index = loop ? Number(loop.index) + 1 : 0;
    if (index >= items.length) return next('completed', {}, null);
    return call('body', { items, index }, { item: items[index] ?? null, index });
  }
});

export const forRangeNode = defineNode({
  type: 'std.flow.for-range',
  version: 1,
  title: 'For Range',
  category: CATEGORY,
  description: 'Runs the body for each integer from first to last inclusive.',
  calls: () => ['body'],
  signature: {
    execIn: ['exec', 'break'],
    execOut: ['body', 'completed'],
    inputs: [pin('first', 'integer', { default: 0 }), pin('last', 'integer')],
    outputs: [pin('index', 'integer')]
  },
  run: async ({ event, state, read }) => {
    if (isBreak(event)) return next('completed', {}, null);
    const loop = event.type === 'return' ? loopState(state) : null;
    const index = loop ? Number(loop.index) + 1 : ((await read('first')) as number);
    const last = loop ? Number(loop.last) : ((await read('last')) as number);
    if (index > last) return next('completed', {}, null);
    return call('body', { index, last }, { index });
  }
});

const whileConfig = v.object({
  maxIterations: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 10_000)
});

export const whileNode = defineNode<v.InferOutput<typeof whileConfig>>({
  type: 'std.flow.while',
  version: 1,
  title: 'While',
  category: CATEGORY,
  description: 'Runs the body while the condition holds, re-checking it after each pass.',
  config: whileConfig,
  calls: () => ['body'],
  signature: {
    execIn: ['exec', 'break'],
    execOut: ['body', 'completed'],
    inputs: [pin('condition', 'boolean')],
    outputs: [pin('iteration', 'integer')]
  },
  run: async ({ event, state, read, config }) => {
    if (isBreak(event)) return next('completed', {}, null);
    const count = event.type === 'return' ? Number(loopState(state).count) : 0;
    if (!(await read('condition'))) return next('completed', {}, null);
    if (count >= config.maxIterations) fail(`While exceeded ${config.maxIterations} iterations`);
    return call('body', { count: count + 1 }, { iteration: count });
  }
});

export const doOnceNode = defineNode({
  type: 'std.flow.do-once',
  version: 1,
  title: 'Do Once',
  category: CATEGORY,
  description: 'Lets execution through only the first time until reset.',
  signature: { execIn: ['exec', 'reset'], execOut: ['then'], inputs: [], outputs: [] },
  run: ({ event, state }) => {
    if (event.type === 'exec' && event.pin === 'reset') return next(null, {}, { done: false });
    return loopState(state).done === true ? next(null) : next('then', {}, { done: true });
  }
});

const gateConfig = v.object({ startClosed: v.optional(v.boolean(), false) });

export const gateNode = defineNode<v.InferOutput<typeof gateConfig>>({
  type: 'std.flow.gate',
  version: 1,
  title: 'Gate',
  category: CATEGORY,
  description: 'Passes enter through to exit only while open.',
  config: gateConfig,
  signature: {
    execIn: ['enter', 'open', 'close', 'toggle'],
    execOut: ['exit'],
    inputs: [],
    outputs: [pin('isOpen', 'boolean')]
  },
  run: ({ event, state, config }) => {
    const s = loopState(state);
    const open = typeof s.open === 'boolean' ? s.open : !config.startClosed;
    const action = event.type === 'exec' ? event.pin : 'enter';
    if (action === 'enter') return next(open ? 'exit' : null, { isOpen: open });
    const isOpen = action === 'open' ? true : action === 'close' ? false : !open;
    return next(null, { isOpen }, { open: isOpen });
  }
});

export const flipFlopNode = defineNode({
  type: 'std.flow.flip-flop',
  version: 1,
  title: 'Flip Flop',
  category: CATEGORY,
  description: 'Alternates between a and b on each execution.',
  signature: {
    execIn: ['exec'],
    execOut: ['a', 'b'],
    inputs: [],
    outputs: [pin('isA', 'boolean')]
  },
  run: ({ state }) => {
    const isA = loopState(state).isA !== true;
    return next(isA ? 'a' : 'b', { isA }, { isA });
  }
});

export const tryNode = defineNode({
  type: 'std.flow.try',
  version: 1,
  title: 'Try',
  category: CATEGORY,
  description: 'Runs try; if anything inside fails, continues through catch with the error.',
  catches: true,
  calls: () => ['try'],
  signature: {
    execIn: ['exec'],
    execOut: ['try', 'then', 'catch'],
    inputs: [],
    outputs: [pin('error', 'string'), pin('errorNode', 'string')]
  },
  run: ({ event }) => {
    if (event.type === 'exec') return call('try', null);
    if (event.type === 'error') {
      return next('catch', {
        error: event.error.message,
        errorNode: `${event.error.path}${event.error.node}`
      });
    }
    return next('then');
  }
});

export const failNode = defineNode({
  type: 'std.flow.fail',
  version: 1,
  title: 'Fail',
  category: CATEGORY,
  description: 'Stops this path with an error that Try nodes or reviewers can handle.',
  signature: { execIn: ['exec'], execOut: [], inputs: [pin('message', 'string')], outputs: [] },
  run: async ({ read }) => fail(String(await read('message')))
});

export const delayNode = defineNode({
  type: 'std.flow.delay',
  version: 1,
  title: 'Delay',
  category: CATEGORY,
  description: 'Durably waits for a number of milliseconds.',
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('ms', 'integer')],
    outputs: []
  },
  run: async ({ event, read, ctx }) =>
    event.type === 'resume'
      ? next('then')
      : suspend({
          kind: 'timer',
          data: {
            until: new Date(ctx.now.getTime() + ((await read('ms')) as number)).toISOString()
          }
        })
});

export const waitUntilNode = defineNode({
  type: 'std.flow.wait-until',
  version: 1,
  title: 'Wait Until',
  category: CATEGORY,
  description: 'Durably waits until a point in time.',
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('until', 'datetime')],
    outputs: []
  },
  run: async ({ event, read }) =>
    event.type === 'resume'
      ? next('then')
      : suspend({
          kind: 'timer',
          data: { until: new Date((await read('until')) as string).toISOString() }
        })
});

export const waitSignalNode = defineNode({
  type: 'std.flow.wait-signal',
  version: 1,
  title: 'Wait For Signal',
  category: CATEGORY,
  description: 'Durably waits for an external signal matching name and key, with optional timeout.',
  signature: {
    execIn: ['exec'],
    execOut: ['received', 'timeout'],
    inputs: [
      pin('name', 'string'),
      pin('key', 'string'),
      pin('timeoutMs', 'integer', { optional: true })
    ],
    outputs: [pin('payload', 'any')]
  },
  run: async ({ event, read, ctx }) => {
    if (event.type === 'resume') {
      const p = event.payload;
      return isRecord(p) && p.timedOut === true
        ? next('timeout')
        : next('received', { payload: isRecord(p) ? (p.payload ?? null) : null });
    }
    const timeout = (await read('timeoutMs')) as number | null;
    return suspend({
      kind: 'signal',
      data: {
        name: await read('name'),
        key: await read('key'),
        until: timeout === null ? null : new Date(ctx.now.getTime() + timeout).toISOString()
      }
    });
  }
});

export const runWorkflowNode = defineNode<v.InferOutput<typeof workflowConfig>>({
  type: 'std.flow.run-workflow',
  version: 1,
  title: 'Run Workflow',
  category: CATEGORY,
  description: 'Starts another workflow as a child run and waits for its result.',
  config: workflowConfig,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('inputs', { object: {} }, { optional: true })],
    outputs: [pin('runId', 'string'), pin('pin', 'string'), pin('outputs', { object: {} })]
  },
  run: async ({ event, read, config }) => {
    if (event.type !== 'resume') {
      return suspend({
        kind: 'workflow',
        data: {
          type: config.workflow,
          version: config.version,
          inputs: (await read('inputs')) ?? {}
        }
      });
    }
    const p = event.payload;
    const err = childError(p);
    if (err !== null || !isRecord(p)) return fail(`Child workflow failed: ${err ?? 'no result'}`);
    return next('then', { runId: p.runId ?? null, pin: p.pin ?? null, outputs: p.outputs ?? {} });
  }
});

export const startWorkflowNode = defineNode<v.InferOutput<typeof workflowConfig>>({
  type: 'std.flow.start-workflow',
  version: 1,
  title: 'Start Workflow',
  category: CATEGORY,
  description: 'Starts another workflow as its own run and continues without waiting for it.',
  config: workflowConfig,
  effect: true,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('inputs', { object: {} }, { optional: true })],
    outputs: [pin('runId', 'string')]
  },
  run: async ({ event, read, config }) => {
    if (event.type !== 'resume') {
      return suspend({
        kind: 'start',
        data: {
          type: config.workflow,
          version: config.version,
          inputs: (await read('inputs')) ?? {}
        }
      });
    }
    const p = event.payload;
    const err = childError(p);
    if (err !== null || !isRecord(p)) return fail(`Could not start workflow: ${err ?? 'no run'}`);
    return next('then', { runId: p.runId ?? null });
  }
});

export const mapWorkflowNode = defineNode<v.InferOutput<typeof workflowConfig>>({
  type: 'std.flow.map-workflow',
  version: 1,
  title: 'Map Workflow',
  category: CATEGORY,
  description: 'Starts one child run per item in parallel and waits for all results.',
  config: workflowConfig,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('items', { list: { object: {} } })],
    outputs: [pin('results', { list: { object: {} } }), pin('runIds', { list: 'string' })]
  },
  run: async ({ event, read, config }) => {
    if (event.type !== 'resume') {
      return suspend({
        kind: 'workflows',
        data: { type: config.workflow, version: config.version, items: await read('items') }
      });
    }
    const results =
      isRecord(event.payload) && Array.isArray(event.payload.results) ? event.payload.results : [];
    const failed = results.map(childError).filter((e) => e !== null);
    if (failed.length) fail(`${failed.length} child workflow(s) failed: ${failed[0]}`);
    return next('then', {
      results: results.map((r) => (isRecord(r) && isRecord(r.outputs) ? r.outputs : {})),
      runIds: results.map((r) => (isRecord(r) && typeof r.runId === 'string' ? r.runId : ''))
    });
  }
});

export const flowNodes: NodeDef[] = [
  branchNode,
  switchNode,
  sequenceNode,
  forEachNode,
  forRangeNode,
  whileNode,
  doOnceNode,
  gateNode,
  flipFlopNode,
  tryNode,
  failNode,
  delayNode,
  waitUntilNode,
  waitSignalNode,
  runWorkflowNode,
  startWorkflowNode,
  mapWorkflowNode
];
