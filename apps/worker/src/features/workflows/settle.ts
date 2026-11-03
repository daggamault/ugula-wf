import type { RunStatus } from '@ugula/db';
import { isRecord, type Json, type RunState, type TraceEntry, type Values } from '@ugula/graph';
import { advance, cancel, type RunJob, resume, timeout } from '@ugula/run-queue';
import type { ChildRun, ClaimedRun, RunTx } from './queries.ts';

const FAULT_QUEUE = 'exceptions';
export const FAULT_OUTCOMES = ['retry', 'skip', 'cancel'];
const STALL_OUTCOMES = ['retry', 'cancel'];

const ENCOUNTER_WORKFLOW = 'billing.encounter-to-claim';

const RECOVER_DRAFT = { key: 'billing.recover-draft', version: 1 };

const RETRY_HINT = 'Retry once the cause is fixed.';

const CONSTRAINT_MESSAGES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /violates check constraint "(\w+)"/,
    (m) => `A saved value broke the rule ${m[1]?.replaceAll('_', ' ')}`
  ],
  [/violates unique constraint/, () => 'It would duplicate a record that already exists'],
  [/violates foreign key constraint/, () => 'It refers to a record that does not exist'],
  [/null value in column "(\w+)"/, (m) => `${m[1]?.replaceAll('_', ' ')} is required`]
];

const sentence = (text: string) => {
  const t = text.trim().replace(/^Error:\s*/, '');
  const capital = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

export const readableError = (message: string) => {
  for (const [pattern, explain] of CONSTRAINT_MESSAGES) {
    const m = message.match(pattern);
    if (m) return sentence(explain(m));
  }
  return sentence(message || 'The step failed');
};

const faultInstructions = (node: string, message: string, rejected: string | null) =>
  [
    ...(rejected ? [sentence(rejected)] : []),
    `${node}: ${readableError(message)}`,
    RETRY_HINT
  ].join('\n\n');

const messageOf = (error: Json) =>
  isRecord(error) && typeof error.message === 'string' ? error.message : 'Run did not complete';

const childResult = (child: ChildRun): Json =>
  child.status === 'completed' && isRecord(child.result)
    ? { runId: child.id, pin: child.result.pin ?? null, outputs: child.result.outputs ?? {} }
    : {
        runId: child.id,
        error: child.status === 'cancelled' ? 'Cancelled' : messageOf(child.error)
      };

export const notifyParent = async (tx: RunTx, run: ClaimedRun, jobs: RunJob[]) => {
  if (!run.parentId || !run.parentWait) return;
  const parent = await tx.lockParent(run.parentId);
  if (parent?.status !== 'suspended' || parent.waitId !== run.parentWait) return;
  if (await tx.hasPendingChildren(run.parentId, run.parentWait)) return;
  jobs.push(resume(run.parentId, run.parentWait, null));
};

export const isChildWait = (kind: string | undefined) =>
  kind === 'workflow' || kind === 'workflows';

export const childrenPayload = (kind: string, children: ChildRun[]): Json => {
  const results = children.map(childResult);
  return kind === 'workflows' ? { results } : (results[0] ?? null);
};

const rootKey = (run: ClaimedRun) => run.graphs.find((g) => g.id === run.versionId)?.key;

const recoverDrafts = async (tx: RunTx, run: ClaimedRun, reason: string, jobs: RunJob[]) => {
  if (rootKey(run) !== ENCOUNTER_WORKFLOW) return;
  const versionId = await tx.findVersion(run.tenantId, RECOVER_DRAFT.key, RECOVER_DRAFT.version);
  if (!versionId) return;
  const ids = await tx.recoverDrafts(run, versionId, reason);
  jobs.push(...ids.map((id) => advance(id)));
};

const finish = async (
  tx: RunTx,
  run: ClaimedRun,
  status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>,
  state: RunState | null,
  outcome: { result?: Json; error?: Json },
  jobs: RunJob[]
) => {
  await tx.saveRun(run, { status, state, ...outcome });
  if (status !== 'completed') {
    await recoverDrafts(
      tx,
      run,
      status === 'cancelled'
        ? 'The run was cancelled'
        : `The run failed: ${messageOf(outcome.error ?? null)}`,
      jobs
    );
  }
  await notifyParent(tx, run, jobs);
};

type ChildKind = 'workflow' | 'workflows' | 'spawn';

const spawn = async (
  tx: RunTx,
  run: ClaimedRun,
  waitId: string,
  data: Record<string, Json>,
  kind: ChildKind,
  jobs: RunJob[]
) => {
  const versionId = await tx.findVersion(run.tenantId, String(data.type), Number(data.version));
  if (!versionId) {
    const error = `Workflow ${String(data.type)}@${String(data.version)} is not published`;
    jobs.push(resume(run.id, waitId, kind === 'workflows' ? { results: [{ error }] } : { error }));
    return;
  }
  const inputs = (kind === 'workflow' ? [data.inputs] : data.items) as Values[];
  const ids = inputs.length ? await tx.insertChildren(run, waitId, versionId, inputs) : [];
  jobs.push(...ids.map((id) => advance(id, run.id)));
  if (kind === 'spawn') jobs.push(resume(run.id, waitId, { runIds: ids }));
  else if (!ids.length) jobs.push(resume(run.id, waitId, { results: [] }));
};

const startDetached = async (
  tx: RunTx,
  run: ClaimedRun,
  waitId: string,
  data: Record<string, Json>,
  jobs: RunJob[]
) => {
  const versionId = await tx.findVersion(run.tenantId, String(data.type), Number(data.version));
  if (!versionId) {
    const error = `Workflow ${String(data.type)}@${String(data.version)} is not published`;
    jobs.push(resume(run.id, waitId, { error }));
    return;
  }
  const inputs = isRecord(data.inputs) ? data.inputs : {};
  const runId = await tx.insertRun(run.tenantId, versionId, inputs);
  jobs.push(advance(runId), resume(run.id, waitId, { runId }));
};

const suspendRun = async (tx: RunTx, run: ClaimedRun, state: RunState, jobs: RunJob[]) => {
  const wait = state.suspension;
  if (!wait) throw new Error(`Run ${run.id} is suspended without a wait`);
  const data = isRecord(wait.data) ? wait.data : {};
  const until = typeof data.until === 'string' ? data.until : null;
  switch (wait.kind) {
    case 'timer':
      await tx.saveRun(run, { status: 'suspended', state });
      jobs.push(resume(run.id, wait.id, null, until ?? new Date(0).toISOString()));
      return;
    case 'signal': {
      const waitKey = `${String(data.name)}:${String(data.key)}`;
      await tx.saveRun(run, { status: 'suspended', state, waitKey });
      const after = typeof data.after === 'number' ? data.after : null;
      if (after !== null && (await tx.lockSignal(run.tenantId, waitKey)) > after) {
        jobs.push(resume(run.id, wait.id, { payload: null }));
      } else if (until) jobs.push(timeout(run.id, wait.id, until));
      return;
    }
    case 'task':
      await tx.saveRun(run, { status: 'suspended', state });
      await tx.insertTask({
        tenantId: run.tenantId,
        runId: run.id,
        waitId: wait.id,
        kind: 'task',
        queue: String(data.queue),
        title: String(data.title),
        subject: typeof data.subject === 'string' && data.subject ? data.subject : null,
        instructions: typeof data.instructions === 'string' ? data.instructions : '',
        context: data.context ?? null,
        fields: data.fields ?? [],
        outcomes: Array.isArray(data.outcomes) ? data.outcomes.map(String) : [],
        defaults: data.defaults ?? null,
        priority: typeof data.priority === 'number' ? data.priority : 0,
        assigneeId: typeof data.assignee === 'string' ? data.assignee : null
      });
      return;
    case 'workflow':
    case 'workflows':
    case 'spawn':
      await tx.saveRun(run, { status: 'suspended', state });
      await spawn(tx, run, wait.id, data, wait.kind, jobs);
      return;
    case 'start':
      await tx.saveRun(run, { status: 'suspended', state });
      await startDetached(tx, run, wait.id, data, jobs);
      return;
    default:
      await finish(
        tx,
        run,
        'failed',
        state,
        { error: { message: `Unsupported wait "${wait.kind}"` } },
        jobs
      );
  }
};

export type FailedNode = {
  title: string;
  exits: string[];
  outputs: string[];
};

export const faultFields = (failed: FailedNode | null): Json =>
  failed?.exits.length
    ? [
        {
          name: 'pin',
          type: 'string',
          label: 'Continue from',
          options: failed.exits.map((value) => ({ value, label: value }))
        }
      ]
    : [];

type Rejection = {
  reason: string;
  at: string;
};

const faultRun = async (
  tx: RunTx,
  run: ClaimedRun,
  state: RunState,
  failed: FailedNode | null,
  rejected: Rejection | null = null
) => {
  const fault = state.fault;
  if (!fault) throw new Error(`Run ${run.id} is faulted without an error`);
  await tx.saveRun(run, { status: 'faulted', state, error: fault.error });
  const node = failed?.title ?? fault.error.node;
  await tx.insertTask({
    tenantId: run.tenantId,
    runId: run.id,
    waitId: rejected ? `fault:${state.seq}:${rejected.at}` : `fault:${state.seq}`,
    kind: 'fault',
    queue: FAULT_QUEUE,
    title: `Stuck at ${node}`,
    subject: await tx.claimReference(run.id),
    instructions: faultInstructions(node, fault.error.message, rejected?.reason ?? null),
    context: { runId: run.id, node, error: fault.error },
    fields: faultFields(failed),
    outcomes: FAULT_OUTCOMES,
    defaults: null,
    priority: 0,
    assigneeId: null
  });
};

export const settleRun = async (
  tx: RunTx,
  run: ClaimedRun,
  state: RunState,
  steps: TraceEntry[],
  failed: FailedNode | null = null
) => {
  const jobs: RunJob[] = [];
  await tx.insertSteps(run.id, steps);
  switch (state.status) {
    case 'running':
      await tx.saveRun(run, { status: 'running', state });
      jobs.push(advance(run.id, run.parentId));
      break;
    case 'completed':
      await finish(tx, run, 'completed', state, { result: state.result }, jobs);
      break;
    case 'faulted':
      await faultRun(tx, run, state, failed);
      break;
    case 'suspended':
      await suspendRun(tx, run, state, jobs);
  }
  await tx.enqueue(jobs);
};

export const refaultRun = (
  tx: RunTx,
  run: ClaimedRun,
  state: RunState,
  failed: FailedNode | null,
  rejected: Rejection
) => faultRun(tx, run, state, failed, rejected);

export const stallRun = async (tx: RunTx, run: ClaimedRun, message: string, at: string) => {
  const error = { message };
  await tx.saveRun(run, { status: 'faulted', state: run.state, error });
  await tx.insertTask({
    tenantId: run.tenantId,
    runId: run.id,
    waitId: `fault:${run.state?.seq ?? 0}:${at}`,
    kind: 'fault',
    queue: FAULT_QUEUE,
    title: 'Could not continue',
    subject: await tx.claimReference(run.id),
    instructions: `${readableError(message)}\n\n${RETRY_HINT}`,
    context: { runId: run.id, error },
    fields: [],
    outcomes: STALL_OUTCOMES,
    defaults: null,
    priority: 0,
    assigneeId: null
  });
};

export const cancelRun = async (tx: RunTx, run: ClaimedRun) => {
  const jobs: RunJob[] = [];
  await finish(tx, run, 'cancelled', run.state, { error: { message: 'Cancelled' } }, jobs);
  await tx.cancelTasks(run.id);
  jobs.push(...(await tx.activeChildren(run.id)).map(cancel));
  await tx.enqueue(jobs);
};
