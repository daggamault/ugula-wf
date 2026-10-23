import { ArrowRightIcon, FileUpIcon } from 'lucide-react';
import { messageOf } from '../../shared/api.ts';
import { formatAgo, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyState, EmptyText } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { pageOf, useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { QueueSummary, TaskSummary, TasksClient } from './client.ts';
import { byQueueOrder, queueInfo, queueSortKey } from './queues.ts';

export type TasksPageProps = {
  client: TasksClient;
  live: Live;
  queue: string | null;
};

const PATH = '/tasks';

export const QUEUE_TABLE = {
  prefix: 'queues',
  sorts: { flow: 'asc', open: 'desc', oldest: 'asc' },
  sort: 'flow'
} as const;

export const TASK_TABLE = {
  sorts: { waiting: 'desc', task: 'asc', queue: 'asc', priority: 'desc' },
  sort: 'waiting'
} as const;

export const MINE_TABLE = { ...TASK_TABLE, prefix: 'mine' } as const;

const QUEUE_VALUES = {
  flow: (q: QueueSummary) => queueSortKey(q.queue),
  open: (q: QueueSummary) => q.open,
  oldest: (q: QueueSummary) => q.oldest
};

export const QueuesTable = ({
  queues,
  sorting,
  onStart
}: {
  queues: readonly QueueSummary[];
  sorting?: TableSorting;
  onStart: (queue: string) => void;
}) => (
  <Table
    label="Work queues"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Queue', sort: 'flow' },
      { label: 'Open', isNumeric: true, sort: 'open' },
      { label: 'Unclaimed', isNumeric: true },
      { label: 'Oldest', sort: 'oldest' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {queues.map((q) => {
      const info = queueInfo(q.queue);
      return (
        <TableRow key={q.queue}>
          <TableCell>
            <span className="flex max-w-xl flex-col gap-0.5 whitespace-normal">
              <TextLink to={`${PATH}?queue=${encodeURIComponent(q.queue)}`}>{info.label}</TextLink>
              {info.description ? (
                <span className="text-surface-fg-muted text-xs font-normal">
                  {info.description}
                </span>
              ) : null}
            </span>
          </TableCell>
          <TableCell kind="numeric">
            <span className="font-semibold">{q.open}</span>
          </TableCell>
          <TableCell kind="numeric" isMuted>
            {q.unassigned}
          </TableCell>
          <TableCell kind="date" isMuted>
            <span title={formatDateTime(q.oldest)}>{formatAgo(q.oldest)}</span>
          </TableCell>
          <TableCell kind="actions">
            <Button
              size="sm"
              tooltipSide="left"
              disabledReason={q.unassigned ? undefined : 'Everything here is claimed by someone.'}
              onClick={() => onStart(q.queue)}
            >
              Start
              <ArrowRightIcon aria-hidden="true" className="size-4" />
            </Button>
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

export const TaskTable = ({
  label,
  tasks,
  sorting
}: {
  label: string;
  tasks: readonly TaskSummary[];
  sorting?: TableSorting;
}) => (
  <Table
    label={label}
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Task', sort: 'task' },
      { label: 'Queue', sort: 'queue' },
      { label: 'Waiting', sort: 'waiting' },
      { label: 'Status', isSecondary: true }
    ]}
  >
    {tasks.map((t) => (
      <TableRow key={t.id}>
        <TableCell>
          <span className="flex flex-col gap-0.5">
            <TextLink to={`/tasks/${t.id}`}>{t.subject ?? t.title}</TextLink>
            {t.subject ? (
              <span className="text-surface-fg-muted text-xs font-normal">{t.title}</span>
            ) : null}
          </span>
        </TableCell>
        <TableCell isMuted>{queueInfo(t.queue).label}</TableCell>
        <TableCell kind="date" isMuted>
          <span title={formatDateTime(t.created_at)}>{formatAgo(t.created_at)}</span>
        </TableCell>
        <TableCell isSecondary>
          {t.kind === 'fault' ? (
            <Badge intent="danger">Stuck run</Badge>
          ) : t.assignee_id ? (
            <Badge intent="info">Claimed</Badge>
          ) : (
            <Badge>Unclaimed</Badge>
          )}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const queueFilters = (
  queues: readonly QueueSummary[],
  selected: string | null,
  filterHref: (name: string, value: string | null) => string
) => [
  { label: 'All', href: filterHref('queue', null), isSelected: selected === null },
  ...[...queues]
    .sort((a, b) => byQueueOrder(a.queue, b.queue))
    .map((q) => ({
      label: `${queueInfo(q.queue).label} (${q.open})`,
      href: filterHref('queue', q.queue),
      isSelected: q.queue === selected
    }))
];

export const TasksPage = ({ client, live, queue }: TasksPageProps) => {
  const queueTable = useTableState(PATH, QUEUE_TABLE);
  const mineTable = useTableState(PATH, MINE_TABLE);
  const openTable = useTableState(PATH, TASK_TABLE);
  const filterHref = useFilterHref(PATH);
  const queues = useResource('task-queues', client.queues, 30_000);
  const mine = useResource(
    `my-tasks:${mineTable.apiQuery}`,
    () => client.mine(mineTable.apiQuery),
    30_000
  );
  const open = useResource(
    `open-tasks:${queue}:${openTable.apiQuery}`,
    () => client.open(queue, openTable.apiQuery),
    30_000
  );
  const notify = useToast();
  useLive(
    live,
    (e) => e.kind === 'task',
    () => {
      queues.reload();
      mine.reload();
      open.reload();
    }
  );

  const start = async (name: string) => {
    try {
      const task = await client.next(name);
      if (task) navigate(`/tasks/${task.id}`);
      else {
        notify({ intent: 'info', title: `Nothing left in ${queueInfo(name).label}` });
        queues.reload();
      }
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not start the queue', description: messageOf(err) });
    }
  };

  const caughtUp = queues.data !== undefined && !queues.data.length;
  const queuePage = queues.data ? pageOf(queues.data, queueTable, QUEUE_VALUES) : null;

  return (
    <Page
      title="Tasks"
      description="Everything waiting on a person. Start a queue to work through it oldest first, or open any task below."
    >
      {queues.error ? <Alert>{queues.error.message}</Alert> : null}
      {caughtUp ? (
        <EmptyState
          reason="clear"
          title="You're All Caught Up"
          action={
            <ButtonLink to="/imports" variant="outline">
              <FileUpIcon aria-hidden="true" className="size-4" />
              Import reports
            </ButtonLink>
          }
        >
          New work shows up here as reports are imported. Drop a NEMSIS file anywhere in the app to
          import one.
        </EmptyState>
      ) : queuePage ? (
        <Section title="Queues" description="Each queue is one kind of decision.">
          <QueuesTable queues={queuePage.items} sorting={queueTable} onStart={start} />
          <Pagination label="Queues" total={queuePage.total} state={queueTable} />
        </Section>
      ) : (
        <PageLoading />
      )}
      {mine.data?.items.length ? (
        <Section title="Claimed by Me" description="Tasks you started. Finish these first.">
          <TaskTable label="Tasks claimed by me" tasks={mine.data.items} sorting={mineTable} />
          <Pagination label="Claimed tasks" total={mine.data.total} state={mineTable} />
        </Section>
      ) : null}
      {queues.data?.length ? (
        <Section title="All Open Tasks" description="Sort by any column; the link keeps your view.">
          <FilterPills
            label="Filter by queue"
            options={queueFilters(queues.data, queue, filterHref)}
          />
          {open.data?.items.length ? (
            <>
              <TaskTable label="Open tasks" tasks={open.data.items} sorting={openTable} />
              <Pagination label="Open tasks" total={open.data.total} state={openTable} />
            </>
          ) : open.loading ? (
            <PageLoading />
          ) : (
            <EmptyText reason="clear">Nothing open in this queue.</EmptyText>
          )}
        </Section>
      ) : null}
    </Page>
  );
};
