import * as v from 'valibot';
import {
  adoptsItemType,
  adoptsType,
  call,
  defineNode,
  next,
  pin,
  pureNode,
  suspend
} from '../define.ts';
import { fail } from '../errors.ts';
import { MAX_RANGE } from '../expr-functions.ts';
import { isRecord, toText } from '../json.ts';
import { type TypeConfig, typeConfig, valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef } from '../types.ts';

const CATEGORY = 'Flow';

const loopState = (state: Json) => (isRecord(state) ? state : {});

const isBreak = (event: { type: string; pin?: string }) =>
  event.type === 'exec' && event.pin === 'break';

const workflowConfig = v.object({
  workflow: v.pipe(v.string(), v.nonEmpty()),
  version: v.pipe(v.number(), v.integer(), v.minValue(1))
});

const workflowSummary = ({ workflow }: { workflow: string }) => `Workflow: ${workflow}`;

const LOOP_EXITS = {
  body: { label: 'Each Pass', description: 'Runs once for each pass.' },
  completed: { label: 'Completed', description: 'Goes on once every pass is done.' }
};

const childError = (payload: Json) =>
  isRecord(payload) && typeof payload.error === 'string' ? payload.error : null;

export const flowBranchNode = defineNode({
  type: 'std.flow.branch',
  version: 1,
  title: 'Branch',
  category: CATEGORY,
  description: 'Goes one way when the condition is true and the other way when it is false.',
  level: 'basic',
  keywords: ['if', 'condition', 'else', 'decide'],
  exits: {
    true: { label: 'True', description: 'The condition is true.' },
    false: { label: 'False', description: 'The condition is false.' }
  },
  signature: {
    execIn: ['exec'],
    execOut: ['true', 'false'],
    inputs: [pin('condition', 'boolean', { description: 'Which way to go.' })],
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
  description:
    'Goes the way of the case that matches the value, or the default way when none does.',
  level: 'basic',
  keywords: ['case', 'match', 'choose', 'route'],
  exits: { default: { label: 'Default', description: 'No case matches the value.' } },
  summary: ({ cases }) => `Cases: ${cases.join(', ')}`,
  config: switchConfig,
  signature: ({ cases }) => ({
    execIn: ['exec'],
    execOut: [...cases, 'default'],
    inputs: [pin('value', 'any', { optional: true, description: 'The value to match to a case.' })],
    outputs: []
  }),
  run: async ({ read, config }) => {
    const value = toText(await read('value'));
    return next(config.cases.includes(value) ? value : 'default');
  }
});

const MAX_STEPS = 32;

const sequenceConfig = v.object({
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_STEPS)), 2)
});

export const sequenceNode = defineNode<v.InferOutput<typeof sequenceConfig>>({
  type: 'std.flow.sequence',
  version: 1,
  title: 'Sequence',
  category: CATEGORY,
  description: 'Does several things one after another, each to the end before the next.',
  level: 'basic',
  keywords: ['then', 'order', 'steps', 'sequence'],
  exits: Object.fromEntries(
    Array.from({ length: MAX_STEPS }, (_, i) => [
      `then${i}`,
      { label: `Then ${i + 1}`, description: `Step ${i + 1}, once the steps before it are done.` }
    ])
  ),
  summary: ({ count }) => `${count} steps`,
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

export const forEachNode = defineNode<TypeConfig>({
  type: 'std.flow.for-each',
  version: 1,
  title: 'For Each',
  category: CATEGORY,
  description: 'Does the same steps once for each item of a list, then goes on.',
  level: 'basic',
  keywords: ['loop', 'each', 'repeat', 'every'],
  exits: {
    body: { label: 'Each Item', description: 'Runs once for each item.' },
    completed: { label: 'Completed', description: 'Goes on once every item is done.' }
  },
  config: typeConfig,
  adopts: adoptsItemType(/^list$/),
  calls: () => ['body'],
  signature: ({ type }) => ({
    execIn: ['exec', 'break'],
    execOut: ['body', 'completed'],
    inputs: [pin('list', { list: type }, { description: 'The items to go through.' })],
    outputs: [
      pin('item', type, { description: 'The item of this pass.' }),
      pin('index', 'integer', { description: 'The position of the item, counting from 0.' })
    ]
  }),
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
  description: 'Does the same steps once for each whole number from first to last, then goes on.',
  level: 'advanced',
  keywords: ['loop', 'count', 'repeat', 'range'],
  exits: LOOP_EXITS,
  calls: () => ['body'],
  signature: {
    execIn: ['exec', 'break'],
    execOut: ['body', 'completed'],
    inputs: [
      pin('first', 'integer', { default: 0, description: 'The first number.' }),
      pin('last', 'integer', { description: 'The last number.' })
    ],
    outputs: [pin('index', 'integer', { description: 'The number of this pass.' })]
  },
  run: async ({ event, state, read }) => {
    if (isBreak(event)) return next('completed', {}, null);
    const loop = event.type === 'return' ? loopState(state) : null;
    const index = loop ? Number(loop.index) + 1 : ((await read('first')) as number);
    const last = loop ? Number(loop.last) : ((await read('last')) as number);
    if (!loop && last - index >= MAX_RANGE) fail(`For Range: at most ${MAX_RANGE} iterations`);
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
  description:
    'Repeats the same steps while the condition is true, checking it again after each pass.',
  level: 'advanced',
  keywords: ['loop', 'repeat', 'until'],
  exits: LOOP_EXITS,
  config: whileConfig,
  calls: () => ['body'],
  signature: {
    execIn: ['exec', 'break'],
    execOut: ['body', 'completed'],
    inputs: [pin('condition', 'boolean', { description: 'Whether to do another pass.' })],
    outputs: [pin('iteration', 'integer', { description: 'The pass, counting from 0.' })]
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
  description: 'Goes on only the first time it is reached, until it is reset.',
  level: 'advanced',
  keywords: ['once', 'first'],
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
  description:
    'Lets the flow through only while the gate is open; other steps open, close or toggle it.',
  level: 'advanced',
  keywords: ['gate', 'block', 'allow'],
  exits: { exit: { label: 'Exit', description: 'The flow went through the open gate.' } },
  config: gateConfig,
  signature: {
    execIn: ['enter', 'open', 'close', 'toggle'],
    execOut: ['exit'],
    inputs: [],
    outputs: [pin('isOpen', 'boolean', { description: 'Whether the gate is open now.' })]
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
  description: 'Goes the first way, then the second way the next time, and so on.',
  level: 'advanced',
  keywords: ['alternate', 'toggle'],
  exits: {
    a: { label: 'A', description: 'The first, third and every other odd time.' },
    b: { label: 'B', description: 'The second, fourth and every other even time.' }
  },
  signature: {
    execIn: ['exec'],
    execOut: ['a', 'b'],
    inputs: [],
    outputs: [pin('isA', 'boolean', { description: 'Whether it went the first way.' })]
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
  description:
    'Tries some steps; if any of them fails, goes the catch way with the error instead of stopping.',
  level: 'advanced',
  keywords: ['error', 'catch', 'fail', 'recover'],
  exits: {
    try: { label: 'Try', description: 'The steps to try.' },
    catch: { label: 'Catch', description: 'A step tried failed.' }
  },
  catches: true,
  calls: () => ['try'],
  signature: {
    execIn: ['exec'],
    execOut: ['try', 'then', 'catch'],
    inputs: [],
    outputs: [
      pin('error', 'string', { description: 'What went wrong.' }),
      pin('errorNode', 'string', { description: 'The step that failed.' })
    ]
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
  description: 'Stops here with an error, for a Try step or a person to deal with.',
  level: 'advanced',
  keywords: ['error', 'stop', 'throw'],
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [pin('message', 'string', { description: 'What went wrong.' })],
    outputs: []
  },
  run: async ({ read }) => fail(String(await read('message')))
});

export const delayNode = defineNode({
  type: 'std.flow.delay',
  version: 1,
  title: 'Delay',
  category: CATEGORY,
  description: 'Waits for a while, even across restarts, then goes on.',
  level: 'advanced',
  keywords: ['wait', 'pause', 'sleep', 'timer'],
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('ms', 'integer', { description: 'How long to wait, in milliseconds.' })],
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
  description: 'Waits until a date and time, even across restarts, then goes on.',
  level: 'advanced',
  keywords: ['wait', 'pause', 'schedule', 'timer'],
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('until', 'datetime', { description: 'When to go on.' })],
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
  title: 'Wait for Signal',
  category: CATEGORY,
  description:
    'Waits, even across restarts, for news from outside, such as a payer answer, named by a name and a key, for at most a while. Given how many such signals were already seen, goes on at once when more arrived meanwhile.',
  level: 'advanced',
  keywords: ['wait', 'signal', 'event', 'callback'],
  exits: {
    received: { label: 'Received', description: 'The signal arrived.' },
    timeout: { label: 'Timed Out', description: 'The signal did not arrive in time.' }
  },
  signature: {
    execIn: ['exec'],
    execOut: ['received', 'timeout'],
    inputs: [
      pin('name', 'string', { description: 'What kind of signal to wait for.' }),
      pin('key', 'string', { description: 'What the signal is about, such as a claim.' }),
      pin('timeoutMs', 'integer', {
        optional: true,
        description: 'How long to wait at most, in milliseconds; forever when empty.'
      }),
      pin('after', 'integer', {
        optional: true,
        description: 'How many of these signals were already seen.'
      })
    ],
    outputs: [pin('payload', 'any', { description: 'What the signal brought.' })]
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
        until: timeout === null ? null : new Date(ctx.now.getTime() + timeout).toISOString(),
        after: await read('after')
      }
    });
  }
});

export const runWorkflowNode = defineNode<v.InferOutput<typeof workflowConfig>>({
  type: 'std.flow.run-workflow',
  version: 1,
  title: 'Run Workflow',
  category: CATEGORY,
  description: 'Runs another workflow and waits for it to finish, then goes on with its results.',
  level: 'basic',
  keywords: ['workflow', 'subworkflow', 'call', 'run'],
  summary: workflowSummary,
  config: workflowConfig,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      pin('inputs', { object: {} }, { optional: true, description: 'The inputs of the workflow.' })
    ],
    outputs: [
      pin('runId', { id: 'run' }, { description: 'The run of the workflow.' }),
      pin('pin', 'string', { description: 'How the workflow ended.' }),
      pin('outputs', { object: {} }, { description: 'The outputs of the workflow.' })
    ]
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
  description: 'Starts another workflow on its own and goes on without waiting for it.',
  level: 'basic',
  keywords: ['workflow', 'start', 'launch', 'background'],
  summary: workflowSummary,
  config: workflowConfig,
  effect: true,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [
      pin('inputs', { object: {} }, { optional: true, description: 'The inputs of the workflow.' })
    ],
    outputs: [pin('runId', { id: 'run' }, { description: 'The run that was started.' })]
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
  description:
    'Runs another workflow once for each item, all at the same time, and waits for every result.',
  level: 'advanced',
  keywords: ['workflow', 'each', 'parallel', 'batch'],
  summary: workflowSummary,
  config: workflowConfig,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('items', { list: { object: {} } }, { description: 'The inputs of each run.' })],
    outputs: [
      pin(
        'results',
        { list: { object: {} } },
        { description: 'The outputs of each run, in order.' }
      ),
      pin('runIds', { list: { id: 'run' } }, { description: 'Each run, in order.' })
    ]
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

export const spawnWorkflowsNode = defineNode<v.InferOutput<typeof workflowConfig>>({
  type: 'std.flow.spawn-workflows',
  version: 1,
  title: 'Spawn Workflows',
  category: CATEGORY,
  description:
    'Starts another workflow once for each item and goes on without waiting; the runs stay linked to this one.',
  level: 'advanced',
  keywords: ['workflow', 'each', 'start', 'batch'],
  summary: workflowSummary,
  config: workflowConfig,
  effect: true,
  signature: {
    execIn: ['exec'],
    execOut: ['then'],
    inputs: [pin('items', { list: { object: {} } }, { description: 'The inputs of each run.' })],
    outputs: [
      pin('runIds', { list: { id: 'run' } }, { description: 'Each run started, in order.' })
    ]
  },
  run: async ({ event, read, config }) => {
    if (event.type !== 'resume') {
      return suspend({
        kind: 'spawn',
        data: { type: config.workflow, version: config.version, items: await read('items') }
      });
    }
    const p = event.payload;
    const err = childError(p);
    if (err !== null || !isRecord(p) || !Array.isArray(p.runIds)) {
      return fail(`Could not start workflows: ${err ?? 'no runs'}`);
    }
    return next('then', { runIds: p.runIds });
  }
});

const rerouteConfig = v.object({ type: v.optional(valueTypeSchema, 'any') });

export const rerouteNode = pureNode<v.InferOutput<typeof rerouteConfig>>({
  type: 'std.flow.reroute',
  title: 'Reroute',
  category: CATEGORY,
  description:
    'A bend in a connection that passes its value on unchanged, to keep the layout tidy.',
  level: 'basic',
  keywords: ['reroute', 'knot', 'wire', 'bend'],
  config: rerouteConfig,
  adopts: adoptsType(/^value$/),
  inputs: ({ type }) => [
    pin('value', type, { optional: true, description: 'The value to pass on.' })
  ],
  outputs: ({ type }) => [pin('value', type, { description: 'The same value, unchanged.' })],
  compute: ({ value }) => ({ value: value ?? null })
});

export const flowNodes: NodeDef[] = [
  rerouteNode,
  flowBranchNode,
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
  mapWorkflowNode,
  spawnWorkflowsNode
];
