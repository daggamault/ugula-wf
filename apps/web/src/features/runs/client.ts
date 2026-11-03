import type { ErrorInfo, GraphDef, Json, RunState, Signature, Values } from '@ugula/graph';
import type { Api } from '../../shared/api.ts';
import type { RunStatus } from '../../shared/ui/run-status-badge.tsx';
import type { Page } from '../../shared/url-state.ts';

export type RunSummary = {
  id: string;
  status: RunStatus;
  parent_id: string | null;
  parent_index: number | null;
  parent_wait: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  graph_id: string;
  key: string;
  name: string;
  version: number;
  version_id: string;
  error_message: string | null;
};

type RunTask = {
  id: string;
  kind: 'task' | 'fault';
  queue: string;
  title: string;
  status: 'open' | 'completed' | 'cancelled';
  created_at: string;
};

export type RunDetail = {
  run: RunSummary & {
    inputs: Values;
    result: { pin: string | null; outputs: Values } | null;
    error: ErrorInfo | null;
    state: RunState | null;
  };
  children: RunSummary[];
  childCount: number;
  tasks: RunTask[];
  ancestors: RunAncestor[];
};

type RunAncestor = { id: string; name: string; status: RunStatus };

export type RunStep = {
  seq: number;
  path: string;
  node: string;
  node_type: string;
  event: string;
  inputs: Values;
  outputs: Values;
  pin: string | null;
  error: ErrorInfo | null;
  started_at: string;
  duration_ms: number;
};

export type RunGraph = {
  key: string;
  version: number;
  definition: GraphDef;
};

export type Startable = {
  graphId: string;
  name: string;
  version: number;
  signature: Signature;
};

const FINISHED_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];

export const isFinished = (status: RunStatus) => FINISHED_STATUSES.includes(status);

export const createRunsClient = (api: Api) => ({
  list: (status: RunStatus | null, query: string, signal?: AbortSignal) =>
    api.get<Page<RunSummary>>(`/api/runs?${status ? `status=${status}&` : ''}${query}`, signal),
  find: (id: string, signal?: AbortSignal) =>
    api.get<RunDetail>(`/api/runs/${encodeURIComponent(id)}`, signal),
  graphs: async (id: string) =>
    (await api.get<{ graphs: RunGraph[] }>(`/api/runs/${encodeURIComponent(id)}/graphs`)).graphs,
  steps: async (id: string, signal?: AbortSignal) =>
    (
      await api.get<{ steps: RunStep[] }>(
        `/api/runs/${encodeURIComponent(id)}/steps?limit=2000`,
        signal
      )
    ).steps,
  start: (graphId: string, inputs: Record<string, Json>) =>
    api.post<{ id: string; version: number }>('/api/runs', { graphId, inputs }),
  cancel: (id: string) =>
    api.post<{ status: string }>(`/api/runs/${encodeURIComponent(id)}/cancel`),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.set('file', file);
    return api.upload<{ file: Json; name: string }>('/api/runs/files', form);
  },
  startable: async (graphId: string): Promise<Startable> => {
    const { graph, versions } = await api.get<{
      graph: { name: string };
      versions: { version: number; published_at: string | null }[];
    }>(`/api/graphs/${encodeURIComponent(graphId)}`);
    const latest = versions.find((v) => v.published_at);
    if (!latest) throw new Error(`${graph.name} has no published version`);
    const { definition } = await api.get<{ definition: GraphDef }>(
      `/api/graphs/${encodeURIComponent(graphId)}/versions/${latest.version}`
    );
    return { graphId, name: graph.name, version: latest.version, signature: definition.signature };
  }
});

export type RunsClient = ReturnType<typeof createRunsClient>;
