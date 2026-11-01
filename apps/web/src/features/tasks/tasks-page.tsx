import { PlayIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatAgo, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Assignee, QueueSummary, TaskFilter, TaskSummary, TasksClient } from './client.ts';
import { byQueueOrder, queueInfo } from './queues.ts';

export type TasksPageProps = {
  client: TasksClient;
  live: Live;
  me: string;
  filter: TaskFilter;
};

const PATH = '/tasks';

export const ASSIGNEES: readonly Assignee[] = ['anyone', 'me', 'unassigned'];

export const TASK_TABLE = {
  sorts: { waiting: 'desc', task: 'asc', queue: 'asc', priority: 'desc' },
  sort: 'waiting'
} as const;

export const assigneeOf = (t: Pick<TaskSummary, 'assignee_id' | 'assignee_email'>, me: string) =>
  t.assignee_id ? (t.assignee_email === me ? 'You' : (t.assignee_email ?? 'Someone')) : null;

export const TaskTable = ({
  tasks,
  me,
  sorting
}: {
  tasks: readonly TaskSummary[];
  me: string;
  sorting?: TableSorting;
}) => (
  <Table
    label="Tasks"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Task', sort: 'task' },
      { label: 'Type', sort: 'queue' },
      { label: 'Waiting', sort: 'waiting' },
      { label: 'Assigned To', isSecondary: true }
    ]}
  >
    {tasks.map((t) => {
      const assignee = assigneeOf(t, me);
      return (
        <TableRow key={t.id}>
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <TextLink to={`/tasks/${t.id}`}>{t.subject ?? t.title}</TextLink>
              {t.subject ? (
                <span className="text-surface-fg-muted text-xs font-normal">{t.title}</span>
              ) : null}
            </span>
          </TableCell>
          <TableCell>
            {t.kind === 'fault' ? (
              <Badge intent="danger">{queueInfo(t.queue).label}</Badge>
            ) : (
              <span className="text-surface-fg-muted">{queueInfo(t.queue).label}</span>
            )}
          </TableCell>
          <TableCell kind="date" isMuted>
            <span title={formatDateTime(t.created_at)}>{formatAgo(t.created_at)}</span>
          </TableCell>
          <TableCell isSecondary isMuted={!assignee}>
            {assignee ?? 'Nobody'}
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

const count = (queues: readonly QueueSummary[], pick: (q: QueueSummary) => number) =>
  queues.reduce((n, q) => n + pick(q), 0);

export const typeFilters = (
  queues: readonly QueueSummary[],
  selected: string | null,
  filterHref: (name: string, value: string | null) => string
) => [
  {
    label: `All (${count(queues, (q) => q.open)})`,
    href: filterHref('queue', null),
    isSelected: selected === null
  },
  ...[...queues]
    .sort((a, b) => byQueueOrder(a.queue, b.queue))
    .map((q) => ({
      label: `${queueInfo(q.queue).label} (${q.open})`,
      href: filterHref('queue', q.queue),
      isSelected: q.queue === selected
    }))
];

export const assigneeFilters = (
  queues: readonly QueueSummary[],
  selected: Assignee,
  filterHref: (name: string, value: string | null) => string
) => {
  const scoped = (pick: (q: QueueSummary) => number) => count(queues, pick);
  const labels: Record<Assignee, string> = {
    anyone: 'Anyone',
    me: `Me (${scoped((q) => q.mine)})`,
    unassigned: `Nobody (${scoped((q) => q.unassigned)})`
  };
  return ASSIGNEES.map((a) => ({
    label: labels[a],
    href: filterHref('assignee', a === 'anyone' ? null : a),
    isSelected: a === selected
  }));
};

export const TasksPage = ({ client, live, me, filter }: TasksPageProps) => {
  const table = useTableState(PATH, TASK_TABLE);
  const filterHref = useFilterHref(PATH);
  const queues = useResource('task-queues', client.queues, 30_000);
  const tasks = useResource(
    `tasks:${filter.queue}:${filter.assignee}:${table.apiQuery}`,
    () => client.list(filter, table.apiQuery),
    30_000
  );
  const [starting, setStarting] = useState(false);
  const notify = useToast();
  useLive(
    live,
    (e) => e.kind === 'task',
    () => {
      queues.reload();
      tasks.reload();
    }
  );

  const all = queues.data ?? [];
  const inScope = filter.queue ? all.filter((q) => q.queue === filter.queue) : all;
  const unassigned = count(inScope, (q) => q.unassigned);
  const info = filter.queue ? queueInfo(filter.queue) : null;

  const start = async () => {
    setStarting(true);
    try {
      const task = await client.next(filter.queue);
      if (task) navigate(`/tasks/${task.id}`);
      else {
        notify({ intent: 'info', title: 'Someone else picked up the last task' });
        queues.reload();
      }
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not start', description: messageOf(err) });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Page
      title="Tasks"
      description="Decisions waiting on a person. Start working to take the oldest unassigned task, or open any task below."
      actions={
        all.length ? (
          <Button
            isPending={starting}
            disabledReason={
              queues.data && !unassigned ? 'Every task here is already assigned.' : undefined
            }
            onClick={() => void start()}
          >
            <PlayIcon aria-hidden="true" className="size-4" />
            Start working
          </Button>
        ) : null
      }
    >
      {queues.error ? <Alert>{queues.error.message}</Alert> : null}
      {queues.data && !all.length ? (
        <EmptyState reason="clear" title="You're All Caught Up">
          New tasks show up here as reports are imported and claims move through their payers.
        </EmptyState>
      ) : queues.data ? (
        <>
          <div className="flex flex-col gap-3">
            <FilterPills
              label="Filter by type"
              options={typeFilters(all, filter.queue, filterHref)}
            />
            <FilterPills
              label="Filter by who it is assigned to"
              options={assigneeFilters(inScope, filter.assignee, filterHref)}
            />
            {info?.description ? (
              <p className="text-surface-fg-muted text-sm">{info.description}</p>
            ) : null}
          </div>
          {tasks.error ? <Alert>{tasks.error.message}</Alert> : null}
          {tasks.data?.items.length ? (
            <>
              <TaskTable tasks={tasks.data.items} me={me} sorting={table} />
              <Pagination label="Tasks" total={tasks.data.total} state={table} />
            </>
          ) : tasks.loading ? (
            <PageLoading />
          ) : (
            <EmptyState reason="noMatches" title="No Tasks Here">
              Nothing matches these filters.
            </EmptyState>
          )}
        </>
      ) : (
        <PageLoading />
      )}
    </Page>
  );
};
