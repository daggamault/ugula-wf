import { ArrowRightIcon, FileUpIcon } from 'lucide-react';
import { useId } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatAgo } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyState, EmptyText } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { QueueSummary, TaskSummary, TasksClient } from './client.ts';
import { byQueueOrder, queueInfo } from './queues.ts';

export type TasksPageProps = {
  client: TasksClient;
  live: Live;
  queue: string | null;
};

const QueueCard = ({
  queue,
  onStart
}: {
  queue: QueueSummary;
  onStart: (queue: string) => void;
}) => {
  const headingId = useId();
  const info = queueInfo(queue.queue);
  return (
    <li>
      <article
        aria-labelledby={headingId}
        className="border-border bg-surface flex h-full flex-col gap-4 rounded-xl border p-5"
      >
        <header className="flex items-start justify-between gap-3">
          <h3 id={headingId} className="text-base font-bold tracking-tight">
            {info.label}
          </h3>
          <span className="text-2xl font-extrabold tabular-nums">{queue.open}</span>
        </header>
        {info.description ? (
          <p className="text-surface-fg-muted text-sm">{info.description}</p>
        ) : null}
        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3">
          <span className="text-surface-fg-muted text-xs">
            {queue.unassigned === queue.open ? 'None claimed' : `${queue.unassigned} unclaimed`} ·
            oldest {formatAgo(queue.oldest)}
          </span>
          <Button
            size="sm"
            tooltipSide="left"
            disabledReason={queue.unassigned ? undefined : 'Everything here is claimed by someone.'}
            onClick={() => onStart(queue.queue)}
          >
            Start
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Button>
        </footer>
      </article>
    </li>
  );
};

export const QueueCards = ({
  queues,
  onStart
}: {
  queues: readonly QueueSummary[];
  onStart: (queue: string) => void;
}) => (
  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {[...queues]
      .sort((a, b) => byQueueOrder(a.queue, b.queue))
      .map((q) => (
        <QueueCard key={q.queue} queue={q} onStart={onStart} />
      ))}
  </ul>
);

export const TaskTable = ({ label, tasks }: { label: string; tasks: readonly TaskSummary[] }) => (
  <Table label={label} head={['Task', 'Queue', { label: 'Waiting', isSecondary: true }, 'Status']}>
    {tasks.map((t) => (
      <TableRow key={t.id}>
        <TableCell>
          <span className="flex flex-col gap-0.5">
            <TextLink to={`/tasks/${t.id}`}>{t.subject ?? t.title}</TextLink>
            {t.subject ? <span className="text-surface-fg-muted text-xs">{t.title}</span> : null}
          </span>
        </TableCell>
        <TableCell isMuted>{queueInfo(t.queue).label}</TableCell>
        <TableCell isMuted isSecondary>
          {formatAgo(t.created_at)}
        </TableCell>
        <TableCell>
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

export const queueFilters = (queues: readonly QueueSummary[], selected: string | null) => [
  { label: 'All', href: '/tasks', isSelected: selected === null },
  ...[...queues]
    .sort((a, b) => byQueueOrder(a.queue, b.queue))
    .map((q) => ({
      label: `${queueInfo(q.queue).label} (${q.open})`,
      href: `/tasks?queue=${encodeURIComponent(q.queue)}`,
      isSelected: q.queue === selected
    }))
];

export const TasksPage = ({ client, live, queue }: TasksPageProps) => {
  const queues = useResource('task-queues', client.queues, 30_000);
  const mine = useResource('my-tasks', client.mine, 30_000);
  const open = useResource('open-tasks', client.open, 30_000);
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

  const listed = (open.data ?? []).filter((t) => queue === null || t.queue === queue);
  const caughtUp = queues.data !== undefined && !queues.data.length;

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
      ) : queues.data ? (
        <Section title="Queues" description="Each queue is one kind of decision.">
          <QueueCards queues={queues.data} onStart={start} />
        </Section>
      ) : (
        <PageLoading />
      )}
      {mine.data?.length ? (
        <Section title="Claimed by Me" description="Tasks you started. Finish these first.">
          <TaskTable label="Tasks claimed by me" tasks={mine.data} />
        </Section>
      ) : null}
      {queues.data?.length ? (
        <Section title="All Open Tasks" description="Oldest first within each priority.">
          <FilterPills label="Filter by queue" options={queueFilters(queues.data, queue)} />
          {listed.length ? (
            <TaskTable label="Open tasks" tasks={listed} />
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
