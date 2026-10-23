import type { RunStatus } from '@ugula/db';
import type { LiveEvent } from '@ugula/events';
import {
  type Engine,
  type Json,
  messageOf,
  type RunState,
  type TraceEntry,
  type Values
} from '@ugula/graph';
import type { RunCommand, RunJob } from '@ugula/jobs';
import type { EngineSource } from './engines.ts';
import { isTransient } from './errors.ts';
import { type ClaimedRun, isLeaseLost, type RunStore } from './queries.ts';
import {
  cancelRun,
  childrenPayload,
  type FailedNode,
  failRun,
  isChildWait,
  refaultRun,
  settleRun
} from './settle.ts';

export type RunnerDeps = {
  store: RunStore;
  engines: EngineSource;
  now: () => Date;
  publish: (tenantId: string, event: LiveEvent) => Promise<void>;
  leaseMs?: number;
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

const apply = (engine: Engine, state: RunState, command: RunCommand) => {
  if (command.type === 'resume') {
    engine.resume(state, command.suspensionId, command.payload as Json);
  } else if (command.type === 'retry') engine.retryFault(state);
  else if (command.type === 'skip') engine.skipFault(state, command.pin, command.outputs as Values);
};

export const createRunner = ({
  store,
  engines,
  now,
  publish,
  leaseMs = 300_000,
  budgetMs = 10_000,
  maxSteps = 5_000,
  flushSize = 200
}: RunnerDeps): Runner => {
  // Tasks only open or close when a run settles (suspends, faults or ends), so any other status
  // leaves task queues as they were.
  const notify = async (run: ClaimedRun, status: string) => {
    const events: LiveEvent[] = [{ kind: 'run', id: run.id, status, parentId: run.parentId }];
    if (status !== 'running') events.push({ kind: 'task', id: null, runId: run.id });
    for (const event of events) await publish(run.tenantId, event).catch(() => undefined);
  };

  const drive = async (
    engine: Engine,
    run: ClaimedRun,
    state: RunState,
    progress: { checkpointed: boolean }
  ) => {
    const deadline = performance.now() + budgetMs;
    let buffer: TraceEntry[] = [];
    for (
      let i = 0;
      state.status === 'running' && i < maxSteps && performance.now() < deadline;
      i++
    ) {
      const step = await engine.advance(state, { runId: run.id, now: now() });
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
    const children = await store.transaction((tx) => tx.children(run.id, wait.id));
    return { ...command, payload: childrenPayload(wait.kind, children) };
  };

  const execute = async (
    run: ClaimedRun,
    command: RunCommand,
    progress: { checkpointed: boolean }
  ) => {
    const { engine, root } = await engines(run.versionId);
    const state = run.state ?? engine.start(root, run.inputs, { now: now() });
    if (command.type === 'advance' && state.status !== 'running') {
      await store.release(run, state.status === 'suspended' ? 'suspended' : 'faulted');
      return;
    }
    const resolved = await withChildResults(run, state, command);
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
    const steps = await drive(engine, run, state, progress);
    await store.transaction((tx) => settleRun(tx, run, state, steps, failedNode(engine, state)));
    await notify(run, state.status);
  };

  const process = async (job: RunJob) => {
    const run = await store.claim(job, leaseMs);
    if (!run) return;
    if (job.command.type === 'cancel') {
      await store.transaction((tx) => cancelRun(tx, run));
      await notify(run, 'cancelled');
      return;
    }
    const progress = { checkpointed: false };
    try {
      await execute(run, job.command, progress);
    } catch (err) {
      if (isLeaseLost(err)) throw err;
      if (isTransient(err)) {
        await store.release(run, progress.checkpointed ? 'running' : priorStatus[job.command.type]);
        throw err;
      }
      await store.transaction((tx) => failRun(tx, run, messageOf(err)));
      await notify(run, 'failed');
    }
  };

  return { process };
};
