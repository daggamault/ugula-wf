import type { GraphDef, RunState } from '@ugula/graph';
import type { Catalog } from '../../shared/graph/catalog.ts';
import type { NodeStatus } from '../../shared/graph/flow.ts';
import type { RunStep } from './client.ts';

export type Cursor = {
  path: string;
  node: string;
  status: Extract<NodeStatus, 'waiting' | 'error'>;
};

export const pathOf = (stack: readonly string[]) => stack.map((id) => `${id}/`).join('');

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
