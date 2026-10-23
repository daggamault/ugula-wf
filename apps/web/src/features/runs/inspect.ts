import type { GraphDef, RunState, Values } from '@ugula/graph';
import type { Catalog } from '../../shared/graph/catalog.ts';
import type { NodeStatus } from '../../shared/graph/flow.ts';
import type { RunDetail, RunStep, RunSummary } from './client.ts';

export type Cursor = {
  path: string;
  node: string;
  status: Extract<NodeStatus, 'waiting' | 'error'>;
};

export const pathOf = (stack: readonly string[]) => stack.map((id) => `${id}/`).join('');

export const parseAt = (raw: string | null) => (raw ?? '').split('/').filter(Boolean);

export const runPath = (runId: string, stack: readonly string[] = []) =>
  `/runs/${runId}${stack.length ? `?at=${stack.map(encodeURIComponent).join('/')}` : ''}`;

export const graphAt = (root: GraphDef, stack: readonly string[], catalog: Catalog) =>
  stack.reduce<GraphDef | undefined>((def, id) => {
    const inst = def?.nodes.find((n) => n.id === id);
    return inst ? catalog.graphOf(inst) : undefined;
  }, root);

export const cursorsOf = (state: RunState | null): Cursor[] => {
  if (!state) return [];
  const at = (scope: string, node: string, status: Cursor['status']) => {
    const path = state.scopes[scope]?.path;
    return path === undefined ? [] : [{ path, node, status }];
  };
  return [
    ...(state.suspension
      ? at(state.suspension.cursor.scope, state.suspension.cursor.node, 'waiting')
      : []),
    ...(state.fault ? at(state.fault.cursor.scope, state.fault.cursor.node, 'error') : [])
  ];
};

export const statusAt = (
  steps: readonly RunStep[],
  state: RunState | null,
  path: string
): Record<string, NodeStatus> => {
  const status: Record<string, NodeStatus> = {};
  for (const step of steps) {
    if (step.path === path) status[step.node] = step.error ? 'error' : 'done';
  }
  for (const cursor of cursorsOf(state)) {
    if (!cursor.path.startsWith(path)) continue;
    const node = cursor.path === path ? cursor.node : cursor.path.slice(path.length).split('/')[0];
    if (node) status[node] = cursor.status;
  }
  return status;
};

export type StartedRun = Pick<RunSummary, 'id'> &
  Partial<Pick<RunSummary, 'name' | 'status' | 'parent_index'>>;

const runIdsIn = (outputs: Values) => [
  ...(typeof outputs.runId === 'string' ? [outputs.runId] : []),
  ...(Array.isArray(outputs.runIds)
    ? outputs.runIds.filter((id): id is string => typeof id === 'string')
    : [])
];

/** Runs a workflow-starting node launched: recorded in its step outputs once it resumes, or
 * linked to the wait it is suspended on while children are still running. */
export const runsStartedBy = (
  detail: RunDetail,
  steps: readonly RunStep[],
  path: string,
  node: string
): StartedRun[] => {
  const { run, children } = detail;
  const recorded = steps
    .filter((s) => s.path === path && s.node === node)
    .flatMap((s) => runIdsIn(s.outputs));
  const wait = run.state?.suspension;
  const waiting =
    wait && wait.cursor.node === node && run.state?.scopes[wait.cursor.scope]?.path === path
      ? children.filter((c) => c.parent_wait === wait.id).map((c) => c.id)
      : [];
  return [...new Set([...recorded, ...waiting])].map(
    (id) => children.find((c) => c.id === id) ?? { id }
  );
};
