import type { FieldSpec, Json } from '@ugula/graph';
import type { ReportDictionary } from '@ugula/nemsis';
import type { Api } from '../../shared/api.ts';
import type { Page } from '../../shared/url-state.ts';

export type TaskStatus = 'open' | 'completed' | 'cancelled';

export type QueueSummary = {
  queue: string;
  open: number;
  unassigned: number;
  mine: number;
  oldest: string;
};

export type Assignee = 'anyone' | 'me' | 'unassigned';

export type TaskFilter = { queue: string | null; assignee: Assignee };

export type TaskSummary = {
  id: string;
  run_id: string;
  kind: 'task' | 'fault';
  queue: string;
  title: string;
  subject: string | null;
  priority: number;
  status: TaskStatus;
  assignee_id: string | null;
  created_at: string;
  completed_at: string | null;
  assignee_email?: string | null;
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

export type TaskSource = {
  reportId: string | null;
  pcrNumber: string | null;
  claimId: string | null;
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
  list: ({ queue, assignee }: TaskFilter, page: string) =>
    api.get<Page<TaskSummary>>(
      `/api/tasks?${queue ? `queue=${encodeURIComponent(queue)}&` : ''}${assignee === 'anyone' ? '' : `assignee=${assignee}&`}${page}`
    ),
  find: async (id: string) => (await api.get<{ task: TaskDetail }>(`/api/tasks/${id}`)).task,
  next: async (queue: string | null) =>
    (await api.post<{ task: TaskDetail | null }>('/api/tasks/next', { queue })).task,
  assign: (id: string) => api.post<{ status: string }>(`/api/tasks/${id}/claim`),
  unassign: (id: string) => api.post<{ status: string }>(`/api/tasks/${id}/release`),
  complete: (id: string, outcome: string, values: Record<string, Json>) =>
    api.post<{ status: string }>(`/api/tasks/${id}/complete`, { outcome, values }),
  report: (id: string) => api.get<SourceReport>(`/api/imports/reports/${id}`)
});

export type TasksClient = ReturnType<typeof createTasksClient>;
