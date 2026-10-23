import type { FieldSpec, Json } from '@ugula/graph';
import type { Api } from '../../shared/api.ts';

export type TaskStatus = 'open' | 'completed' | 'cancelled';

export type QueueSummary = {
  queue: string;
  open: number;
  unassigned: number;
  oldest: string;
};

export type TaskSummary = {
  id: string;
  run_id: string;
  kind: 'task' | 'fault';
  queue: string;
  title: string;
  priority: number;
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
};

export const createTasksClient = (api: Api) => ({
  queues: async () => (await api.get<{ queues: QueueSummary[] }>('/api/tasks/queues')).queues,
  mine: async () => (await api.get<{ tasks: TaskSummary[] }>('/api/tasks?mine=true')).tasks,
  find: async (id: string) => (await api.get<{ task: TaskDetail }>(`/api/tasks/${id}`)).task,
  next: async (queue: string) =>
    (await api.post<{ task: TaskDetail | null }>('/api/tasks/next', { queue })).task,
  claim: (id: string) => api.post<{ status: string }>(`/api/tasks/${id}/claim`),
  release: (id: string) => api.post<{ status: string }>(`/api/tasks/${id}/release`),
  complete: (id: string, outcome: string, values: Record<string, Json>) =>
    api.post<{ status: string }>(`/api/tasks/${id}/complete`, { outcome, values })
});

export type TasksClient = ReturnType<typeof createTasksClient>;
