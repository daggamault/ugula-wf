import type { Permission } from '@ugula/access';
import type { FieldSpec, Json } from '@ugula/graph';
import type { Api } from '../../shared/api.ts';
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
};

export type TaskDetail = TaskSummary & {
  summary: string | null;
  instructions: string;
  context: Json;
  fields: FieldSpec[];
  outcomes: string[];
  hints: Readonly<Record<string, string>>;
  defaults: Record<string, Json> | null;
  prefill: 'current' | 'suggested' | null;
  resolution: { outcome: string; values: Record<string, Json>; note?: string } | null;
};

export const createTasksClient = (api: Api) => ({
  list: (query: string, signal?: AbortSignal) =>
    api.get<Page<TaskRow>>(`/api/tasks?${query}`, signal),
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
  complete: (id: string, outcome: string, values: Record<string, Json>, note = '') =>
    api.post<{ status: string }>(`/api/tasks/${encodeURIComponent(id)}/complete`, {
      outcome,
      values,
      note
    }),
  uploadFile: (id: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return api.upload<{ file: Json; name: string }>(
      `/api/tasks/${encodeURIComponent(id)}/files`,
      form
    );
  }
});

export type TasksClient = ReturnType<typeof createTasksClient>;
