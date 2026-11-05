import { useEffect, useRef } from 'react';
import { type Live, useLive } from '../../shared/live.ts';
import { queueInfo } from '../../shared/task-queues.ts';
import type { Notify } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { QueueSummary, TasksClient } from './client.ts';

type NewWork = { queue: string; added: number };

export const newWork = (
  before: readonly QueueSummary[] | undefined,
  after: readonly QueueSummary[]
): NewWork[] =>
  before
    ? after.flatMap((q) => {
        const added = q.open - (before.find((p) => p.queue === q.queue)?.open ?? 0);
        return added > 0 ? [{ queue: q.queue, added }] : [];
      })
    : [];

export const workToast = ({ queue, added }: NewWork) => {
  const { label } = queueInfo(queue);
  return {
    key: `new-work:${queue}`,
    isRecorded: false,
    intent: 'info' as const,
    title: `${added} new ${added === 1 ? 'task' : 'tasks'} in ${label}`,
    action: { label: `Open ${label}`, to: `/tasks?queue=${encodeURIComponent(queue)}` }
  };
};

export const useWorkAlerts = (client: TasksClient, live: Live, notify: Notify, quiet: boolean) => {
  const queues = useResource('work-alert-queues', client.queues, 60_000);
  useLive(live, (e) => e.kind === 'task', queues.reload);
  const seen = useRef<readonly QueueSummary[] | undefined>(undefined);
  useEffect(() => {
    if (!queues.data) return;
    if (!quiet) for (const work of newWork(seen.current, queues.data)) notify(workToast(work));
    seen.current = queues.data;
  }, [queues.data, notify, quiet]);
  return queues.data?.reduce((n, q) => n + q.open, 0) ?? 0;
};
