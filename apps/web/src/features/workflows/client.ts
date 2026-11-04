import type { GraphDef, Issue } from '@ugula/graph';
import type { Api } from '../../shared/api.ts';
import type { PublishedNode } from '../../shared/graph/catalog.ts';
import type { Page } from '../../shared/url-state.ts';

export type GraphKind = 'workflow' | 'node';

export type GraphScope = 'system' | 'organization' | 'agency';

export type EditScope = Exclude<GraphScope, 'system'>;

export type GraphSummary = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  scope: GraphScope;
  isSystem: boolean;
  overrides: string | null;
  overriddenBy: string | null;
  isStale: boolean;
  publishedVersion: number | null;
  draftVersion: number | null;
  updatedAt: string;
};

type GraphVersionSummary = {
  id: string;
  version: number;
  published_at: string | null;
  created_at: string;
  base_version: number | null;
  base_graph_id: string | null;
};

export type GraphDetail = {
  graph: {
    id: string;
    scope: GraphScope;
    key: string;
    name: string;
    kind: GraphKind;
    description: string;
    overridden_by: string | null;
    overrides: string | null;
    is_stale: boolean;
    canEdit: boolean;
    canOverride: Record<EditScope, boolean>;
    effectiveId: string;
  };
  versions: GraphVersionSummary[];
};

type GraphVersion = {
  id: string;
  version: number;
  definition: GraphDef;
  published_at: string | null;
};

type Compared = { version: number; definition: GraphDef };

export type GraphComparison = {
  mine: Compared | null;
  copiedFrom: (Compared & { graphId: string; scope: GraphScope }) | null;
  latest: Compared | null;
  baseChanged: boolean;
};

export type NewGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  scope?: EditScope;
};

const graphPathOf = (id: string) => `/api/graphs/${encodeURIComponent(id)}`;

export const createWorkflowsClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<GraphSummary>>(`/api/graphs?${query}`, signal),
  nodes: async () => (await api.get<{ nodes: PublishedNode[] }>('/api/graphs/nodes')).nodes,
  find: (id: string, signal?: AbortSignal) => api.get<GraphDetail>(graphPathOf(id), signal),
  compare: (id: string, signal?: AbortSignal) =>
    api.get<GraphComparison>(`${graphPathOf(id)}/compare`, signal),
  version: (id: string, version: number) =>
    api.get<GraphVersion>(`${graphPathOf(id)}/versions/${version}`),
  create: (input: NewGraph) => api.post<{ id: string }>('/api/graphs', input),
  saveDraft: (id: string, definition: GraphDef) =>
    api.put<{ version: number; issues: Issue[] }>(`${graphPathOf(id)}/draft`, { definition }),
  publish: (id: string) => api.post<{ version: number }>(`${graphPathOf(id)}/publish`),
  override: (id: string, scope: EditScope = 'agency') =>
    api.post<{ id: string }>(`${graphPathOf(id)}/override`, { scope }),
  rebase: (id: string, mode: 'keep' | 'reset') =>
    api.post<{ id: string }>(`${graphPathOf(id)}/rebase`, { mode }),
  remove: (id: string) => api.remove<{ id: string }>(graphPathOf(id))
});

export type WorkflowsClient = ReturnType<typeof createWorkflowsClient>;
