import type { RunStatus } from '@ugula/db';
import {
  type Engine,
  isRecord,
  type Json,
  messageOf,
  type RunState,
  type TraceEntry,
  type Values
} from '@ugula/graph';
import type { LiveEvent } from '@ugula/live';
import type { RunCommand, RunJob } from '@ugula/run-queue';
import type { RunContext } from '../../shared/run-scope.ts';
import type { EngineSource } from './engines.ts';
import { isTransient } from './errors.ts';
import { type ClaimedRun, isLeaseLost, type RunStore } from './queries.ts';
import {
  cancelRun,
  childrenPayload,
  type FailedNode,
  isChildWait,
  refaultRun,
  settleRun,
  stallRun
} from './settle.ts';

type RunnerDeps = {
  store: RunStore;
  engines: EngineSource;
  now: () => Date;
  publish: (tenantId: string, event: LiveEvent) => Promise<void>;
  within?: (run: RunContext, work: () => Promise<void>) => Promise<void>;
  leaseMs?: number;
  heartbeatMs?: number;
  budgetMs?: number;
  maxSteps?: number;
  flushSize?: number;
};

export type Runner = {
  process: (job: RunJob) => Promise<void>;
};

const priorStatus: Record<RunCommand['type'], RunStatus> = {
  advance: 'running',
  resume: 'suspended',
  retry: 'faulted',
  skip: 'faulted',
  cancel: 'running'
};

const failedNode = (engine: Engine, state: RunState): FailedNode | null => {
  const failed = state.fault ? engine.nodeAt(state, state.fault.cursor) : null;
  return (
    failed && {
      title: failed.title,
      exits: failed.exits,
      outputs: failed.signature.outputs.map((p) => p.name)
    }
  );
};

const timeoutConsumed = (state: RunState, command: RunCommand) => {
  const wait = state.status === 'suspended' ? state.suspension : null;
  return command.type === 'resume' &&
    wait?.kind === 'signal' &&
    wait.id === command.suspensionId &&
    isRecord(wait.data) &&
    typeof wait.data.until === 'string' &&
    !(isRecord(command.payload) && command.payload.timedOut === true)
    ? wait.id
    : null;
};

const skippedOutputs = (engine: Engine, state: RunState): Values =>
  Object.fromEntries((failedNode(engine, state)?.outputs ?? []).map((name) => [name, null]));

const apply = (engine: Engine, state: RunState, command: RunCommand) => {
  if (command.type === 'resume') {
    engine.resume(state, command.suspensionId, command.payload as Json);
  } else if (command.type === 'retry' && state.status === 'faulted') engine.retryFault(state);
  else if (command.type === 'skip') {
    engine.skipFault(state, command.pin, skippedOutputs(engine, state));
  }
};

export const createRunner = ({
  store,
  engines,
  now,
  publish,
  within = (_, work) => work(),
  leaseMs = 300_000,
  heartbeatMs = leaseMs / 3,
  budgetMs = 10_000,
  maxSteps = 5_000,
  flushSize = 200
}: RunnerDeps): Runner => {
  const notify = async (run: ClaimedRun, status: string) => {
    const events: LiveEvent[] = [{ kind: 'run', id: run.id, status, parentId: run.parentId }];
    if (status !== 'running') events.push({ kind: 'task', id: null, runId: run.id });
    for (const event of events) await publish(run.tenantId, event).catch(() => undefined);
  };

  const drive = async (
    engine: Engine,
    run: ClaimedRun,
    state: RunState,
    progress: { checkpointed: boolean },
    signal: AbortSignal
  ) => {
    const deadline = performance.now() + budgetMs;
    let buffer: TraceEntry[] = [];
    for (
      let i = 0;
      state.status === 'running' && i < maxSteps && performance.now() < deadline;
      i++
    ) {
      signal.throwIfAborted();
      const step = await engine.advance(state, { runId: run.id, now: now(), signal });
      buffer.push(...step.trace);
      if (state.status === 'running' && (step.checkpoint || buffer.length >= flushSize)) {
        await store.checkpoint(run, state, buffer, leaseMs);
        progress.checkpointed = true;
        await notify(run, state.status);
        buffer = [];
      }
    }
    return buffer;
  };

  const withChildResults = async (
    run: ClaimedRun,
    state: RunState,
    command: RunCommand
  ): Promise<RunCommand> => {
    const wait = state.suspension;
    if (
      command.type !== 'resume' ||
      command.payload !== null ||
      wait?.id !== command.suspensionId ||
      !isChildWait(wait.kind)
    ) {
      return command;
    }
    const children = await store.children(run.id, wait.id);
    return { ...command, payload: childrenPayload(wait.kind, children) };
  };

  const execute = async (
    run: ClaimedRun,
    command: RunCommand,
    progress: { checkpointed: boolean },
    signal: AbortSignal
  ) => {
    const { engine, root } = await engines(run);
    const state = run.state ?? engine.start(root, run.inputs, { now: now() });
    if (command.type === 'advance' && state.status !== 'running') {
      await store.release(run, state.status === 'suspended' ? 'suspended' : 'faulted');
      return;
    }
    const resolved = await withChildResults(run, state, command);
    const consumed = timeoutConsumed(state, resolved);
    try {
      apply(engine, state, resolved);
    } catch (err) {
      if (command.type !== 'retry' && command.type !== 'skip') throw err;
      await store.transaction((tx) =>
        refaultRun(tx, run, state, failedNode(engine, state), {
          reason: `Could not ${command.type}: ${messageOf(err)}`,
          at: now().toISOString()
        })
      );
      await notify(run, 'faulted');
      return;
    }
    const steps = await drive(engine, run, state, progress, signal);
    signal.throwIfAborted();
    await store.transaction(async (tx) => {
      if (consumed) await tx.dropTimeout(run.id, consumed);
      await settleRun(tx, run, state, steps, failedNode(engine, state));
    });
    await notify(run, state.status);
  };

  const hold = (run: ClaimedRun) => {
    const lost = new AbortController();
    const timer = setInterval(() => {
      store.extend(run, leaseMs).catch((err: unknown) => {
        clearInterval(timer);
        lost.abort(err);
      });
    }, heartbeatMs);
    timer.unref();
    return { signal: lost.signal, stop: () => clearInterval(timer) };
  };

  const handle = async (run: ClaimedRun, command: RunCommand, signal: AbortSignal) => {
    if (command.type === 'cancel') {
      await store.transaction((tx) => cancelRun(tx, run));
      await notify(run, 'cancelled');
      return;
    }
    const progress = { checkpointed: false };
    try {
      await execute(run, command, progress, signal);
    } catch (err) {
      if (isLeaseLost(err)) throw err;
      if (isTransient(err)) {
        await store.release(run, progress.checkpointed ? 'running' : priorStatus[command.type]);
        throw err;
      }
      await store.transaction((tx) => stallRun(tx, run, messageOf(err), now().toISOString()));
      await notify(run, 'faulted');
    }
  };

  const process = async (job: RunJob) => {
    const run = await store.claim(job, leaseMs);
    if (!run) return;
    const held = hold(run);
    try {
      await within({ runId: run.id, tenantId: run.tenantId, signal: held.signal }, () =>
        handle(run, job.command, held.signal)
      );
    } catch (err) {
      if (!isLeaseLost(err)) throw err;
    } finally {
      held.stop();
    }
  };

  return { process };
};
