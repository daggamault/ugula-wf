import type { Permission } from '@ugula/access';
import type { ClaimStatus } from '@ugula/billing';
import type { FieldSpec, Json } from '@ugula/graph';
import type { ReportDictionary } from '@ugula/nemsis';
import type { Api } from '../../shared/api.ts';

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

export type TaskDetail = TaskSummary & {
  instructions: string;
  context: Json;
  fields: FieldSpec[];
  outcomes: string[];
  defaults: Record<string, Json> | null;
  resolution: { outcome: string; values: Record<string, Json> } | null;
  source: TaskSource;
};

type TaskClaim = {
  id: string;
  number: number;
  status: ClaimStatus;
  patient: string | null;
};

type TaskSource = {
  reportId: string | null;
  pcrNumber: string | null;
  claim: TaskClaim | null;
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
  queues: async () => (await api.get<{ queues: QueueSummary[] }>('/api/tasks/queues')).queues,
  find: async (id: string, signal?: AbortSignal) =>
    (await api.get<{ task: TaskDetail }>(`/api/tasks/${encodeURIComponent(id)}`, signal)).task,
  next: async (queue: string | null) =>
    (await api.post<{ task: TaskDetail | null }>('/api/tasks/next', { queue })).task,
  assign: (id: string) =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/claim`),
  unassign: (id: string) =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/release`),
  complete: (id: string, outcome: string, values: Record<string, Json>) =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/complete`, {
      outcome,
      values
    }),
  report: (id: string) => api.get<SourceReport>(`/api/imports/reports/${encodeURIComponent(id)}`)
});

export type TasksClient = ReturnType<typeof createTasksClient>;
