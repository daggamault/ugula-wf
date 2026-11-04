import type { GraphDef, Issue, Json } from '@ugula/graph';
import type { Api } from '../../shared/api.ts';
import type { PublishedNode } from '../../shared/graph/catalog.ts';
import type { Page } from '../../shared/url-state.ts';

export type GraphKind = 'workflow' | 'node';

export type GraphRole = 'workflow' | 'stage' | 'rule' | 'slot';

export type GraphScope = 'system' | 'organization' | 'agency';

export type EditScope = Exclude<GraphScope, 'system'>;

export type GraphSummary = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
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

type Overridable = {
  id: string;
  scope: GraphScope;
  key: string;
  name: string;
  description: string;
  overridden_by: string | null;
  overrides: string | null;
  is_stale: boolean;
  canEdit: boolean;
  canOverride: Record<EditScope, boolean>;
  effectiveId: string;
  effectiveScope: GraphScope;
};

export type GraphDetail = {
  graph: Overridable & { kind: GraphKind; role: GraphRole };
  versions: GraphVersionSummary[];
};

type GraphVersion = {
  id: string;
  version: number;
  definition: GraphDef;
  published_at: string | null;
};

type Compared<D> = { version: number; definition: D };

type Comparison<D> = {
  mine: Compared<D> | null;
  copiedFrom: (Compared<D> & { scope: GraphScope }) | null;
  latest: Compared<D> | null;
  baseChanged: boolean;
};

export type GraphComparison = Comparison<GraphDef>;

export type NewGraph = {
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  scope?: EditScope;
};

export type MapGraph = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  scope: GraphScope;
  children: string[];
  tables: string[];
};

export type EffectiveTable = { id: string; key: string; name: string; scope: GraphScope };

export type CustomizationMap = { graphs: MapGraph[]; tables: EffectiveTable[] };

export type TableKind = 'decide' | 'lookup';

export type TableSummary = {
  id: string;
  key: string;
  name: string;
  kind: TableKind;
  description: string;
  scope: GraphScope;
  overrides: string | null;
  overriddenBy: string | null;
  isStale: boolean;
  publishedVersion: number | null;
  draftVersion: number | null;
  updatedAt: string;
};

export type TableDetail = {
  table: Overridable & { kind: TableKind };
  versions: (Omit<GraphVersionSummary, 'base_graph_id'> & { base_table_id: string | null })[];
};

export type TableComparison = Comparison<Json>;

const graphPathOf = (id: string) => `/api/graphs/${encodeURIComponent(id)}`;

const tablePathOf = (id: string) => `/api/tables/${encodeURIComponent(id)}`;

export const createWorkflowsClient = (api: Api) => ({
  search: (query: string, signal?: AbortSignal) =>
    api.get<Page<GraphSummary>>(`/api/graphs?${query}`, signal),
  nodes: async () => (await api.get<{ nodes: PublishedNode[] }>('/api/graphs/nodes')).nodes,
  map: (signal?: AbortSignal) => api.get<CustomizationMap>('/api/graphs/map', signal),
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
  remove: (id: string) => api.remove<{ id: string }>(graphPathOf(id)),
  tables: {
    search: (query: string, signal?: AbortSignal) =>
      api.get<Page<TableSummary>>(`/api/tables?${query}`, signal),
    effective: async () =>
      (await api.get<{ tables: EffectiveTable[] }>('/api/tables/effective')).tables,
    find: (id: string, signal?: AbortSignal) => api.get<TableDetail>(tablePathOf(id), signal),
    compare: (id: string, signal?: AbortSignal) =>
      api.get<TableComparison>(`${tablePathOf(id)}/compare`, signal),
    version: (id: string, version: number) =>
      api.get<{ id: string; version: number; definition: Json; published_at: string | null }>(
        `${tablePathOf(id)}/versions/${version}`
      ),
    saveDraft: (id: string, definition: Json) =>
      api.put<{ version: number }>(`${tablePathOf(id)}/draft`, { definition }),
    publish: (id: string) => api.post<{ version: number }>(`${tablePathOf(id)}/publish`),
    override: (id: string, scope: EditScope) =>
      api.post<{ id: string }>(`${tablePathOf(id)}/override`, { scope }),
    remove: (id: string) => api.remove<{ id: string }>(tablePathOf(id))
  }
});

export type WorkflowsClient = ReturnType<typeof createWorkflowsClient>;
