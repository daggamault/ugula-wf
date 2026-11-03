import type { GraphDef, Issue } from '@ugula/graph';
import type { Api } from '../../shared/api.ts';
import type { PublishedNode } from '../../shared/graph/catalog.ts';
import type { Page } from '../../shared/url-state.ts';

export type GraphKind = 'workflow' | 'node';

export type GraphSummary = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  isSystem: boolean;
  overrides: boolean;
  overriddenBy: string | null;
  publishedVersion: number | null;
  draftVersion: number | null;
  updatedAt: string;
};

export type GraphVersionSummary = {
  id: string;
  version: number;
  published_at: string | null;
  created_at: string;
};

export type GraphDetail = {
  graph: {
    id: string;
    tenant_id: string | null;
    key: string;
    name: string;
    kind: GraphKind;
    description: string;
    overridden_by: string | null;
    overrides: string | null;
  };
  versions: GraphVersionSummary[];
};

export type GraphVersion = {
  id: string;
  version: number;
  definition: GraphDef;
  published_at: string | null;
};

export type NewGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
};

export const createWorkflowsClient = (api: Api) => ({
  search: (query: string) => api.get<Page<GraphSummary>>(`/api/graphs?${query}`),
  nodes: async () => (await api.get<{ nodes: PublishedNode[] }>('/api/graphs/nodes')).nodes,
  find: (id: string) => api.get<GraphDetail>(`/api/graphs/${id}`),
  version: (id: string, version: number) =>
    api.get<GraphVersion>(`/api/graphs/${id}/versions/${version}`),
  create: (input: NewGraph) => api.post<{ id: string }>('/api/graphs', input),
  saveDraft: (id: string, definition: GraphDef) =>
    api.put<{ version: number; issues: Issue[] }>(`/api/graphs/${id}/draft`, { definition }),
  publish: (id: string) => api.post<{ version: number }>(`/api/graphs/${id}/publish`),
  override: (id: string) => api.post<{ id: string }>(`/api/graphs/${id}/override`),
  remove: (id: string) => api.remove<{ id: string }>(`/api/graphs/${id}`)
});

export type WorkflowsClient = ReturnType<typeof createWorkflowsClient>;
