import type { Permission } from '@ugula/access';
import type { ClaimBilling, ClaimIssue, CodeDescriptions } from '@ugula/billing';
import type { FieldSpec, Json } from '@ugula/graph';
import type { ReportDictionary } from '@ugula/nemsis';
import type { Api } from '../../shared/api.ts';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import type { Page } from '../../shared/url-state.ts';

type TaskStatus = 'open' | 'completed' | 'cancelled';

export type QueueSummary = {
  queue: string;
  open: number;
  unassigned: number;
  mine: number;
  oldest: string;
};

type TaskSummary = {
  id: string;
  run_id: string;
  kind: 'task' | 'fault';
  queue: string;
  title: string;
  subject: string | null;
  priority: number;
  due_at: string | null;
  permission: Permission | null;
  status: TaskStatus;
  assignee_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export type TaskAssignee = 'mine' | 'unassigned' | 'all';

export type TaskFilter = { queue: string | null; assignee: TaskAssignee };

export type TaskRow = {
  id: string;
  kind: 'task' | 'fault';
  queue: string;
  title: string;
  subject: string | null;
  priority: number;
  due_at: string | null;
  assignee_id: string | null;
  assignee_email: string | null;
  created_at: string;
  claim_id: string | null;
  claim_number: string | null;
  first_name: string | null;
  last_name: string | null;
};

const TASK_ASSIGNEES: readonly TaskAssignee[] = ['mine', 'unassigned', 'all'];

export const taskFilterOf = (query: URLSearchParams): TaskFilter => ({
  queue: query.get('queue') || null,
  assignee: TASK_ASSIGNEES.find((a) => a === query.get('assignee')) ?? 'all'
});

export type TaskDetail = TaskSummary & {
  summary: string | null;
  instructions: string;
  context: Json;
  fields: FieldSpec[];
  outcomes: string[];
  hints: Readonly<Record<string, string>>;
  defaults: Record<string, Json> | null;
  prefill: 'current' | 'suggested' | null;
  resolution: { outcome: string; values: Record<string, Json> } | null;
  source: TaskSource;
};

type TaskSource = {
  reportId: string | null;
  pcrNumber: string | null;
  claimId: string | null;
};

export type TaskClaimRecord = {
  claim: ClaimDetail;
  codes: CodeDescriptions;
  billing: ClaimBilling | null;
  issues: ClaimIssue[];
};

export type SourceReport = {
  report: {
    id: string;
    position: number;
    pcr_number: string | null;
    import_id: string;
    file_name: string;
    created_at: string;
  };
  data: Json;
  xml: string;
  dictionary: ReportDictionary;
};

export const createTasksClient = (api: Api) => ({
  list: (filter: TaskFilter, query: string, signal?: AbortSignal) => {
    const params = new URLSearchParams(query);
    if (filter.queue) params.set('queue', filter.queue);
    if (filter.assignee !== 'all') params.set('assignee', filter.assignee);
    return api.get<Page<TaskRow>>(`/api/tasks?${params}`, signal);
  },
  queues: async () => (await api.get<{ queues: QueueSummary[] }>('/api/tasks/queues')).queues,
  find: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ task: TaskDetail }>(`/api/tasks/${encodeURIComponent(id)}`, signal)).task,
  next: async (queue: string | null) =>
    (await api.post<{ task: TaskDetail | null }>('/api/tasks/next', { queue })).task,
  assign: (id: string) =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/claim`),
  unassign: (id: string) =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/release`),
  followUp: async (runId: string, after: string) =>
    (
      await api.get<Page<{ id: string; title: string; subject: string | null }>>(
        `/api/tasks?runId=${encodeURIComponent(runId)}`
      )
    ).items.find((t) => t.id !== after) ?? null,
  complete: (id: string, outcome: string, values: Record<string, Json>) =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/complete`, {
      outcome,
      values
    }),
  uploadFile: (id: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return api.upload<{ file: Json; name: string }>(
      `/api/tasks/${encodeURIComponent(id)}/files`,
      form
    );
  },
  claim: (id: string, signal?: AbortSignal) =>
    api.get<TaskClaimRecord>(`/api/claims/${encodeURIComponent(id)}`, signal),
  report: (id: string) => api.get<SourceReport>(`/api/imports/reports/${encodeURIComponent(id)}`)
});

export type TasksClient = ReturnType<typeof createTasksClient>;
