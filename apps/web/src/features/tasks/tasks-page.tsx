import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { QueueSummary, TaskSummary, TasksClient } from './client.ts';

export type TasksPageProps = {
  client: TasksClient;
  live: Live;
};

export const QueuesTable = ({
  queues,
  onWork
}: {
  queues: readonly QueueSummary[];
  onWork: (queue: string) => void;
}) => (
  <Table
    label="Work queues"
    head={[
      'Queue',
      { label: 'Open', isNumeric: true },
      { label: 'Unassigned', isNumeric: true },
      { label: 'Oldest', isSecondary: true },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {queues.map((q) => (
      <TableRow key={q.queue}>
        <TableCell>
          <span className="font-semibold">{q.queue}</span>
        </TableCell>
        <TableCell kind="numeric">{q.open}</TableCell>
        <TableCell kind="numeric">
          {q.unassigned ? <Badge intent="warning">{q.unassigned}</Badge> : q.unassigned}
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDateTime(q.oldest)}
        </TableCell>
        <TableCell kind="actions">
          <Button
            variant="outline"
            size="sm"
            tooltipSide="left"
            disabledReason={q.unassigned ? undefined : 'Every task here is assigned.'}
            onClick={() => onWork(q.queue)}
          >
            Work next
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Button>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const MyTasksTable = ({ tasks }: { tasks: readonly TaskSummary[] }) => (
  <Table label="My tasks" head={['Task', 'Queue', { label: 'Created', isSecondary: true }]}>
    {tasks.map((t) => (
      <TableRow key={t.id}>
        <TableCell>
          <span className="flex flex-wrap items-center gap-2">
            <TextLink to={`/tasks/${t.id}`}>{t.title}</TextLink>
            {t.kind === 'fault' ? <Badge intent="danger">Stuck run</Badge> : null}
          </span>
        </TableCell>
        <TableCell isMuted>{t.queue}</TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDateTime(t.created_at)}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const TasksPage = ({ client, live }: TasksPageProps) => {
  const queues = useResource('task-queues', client.queues, 30_000);
  const mine = useResource('my-tasks', client.mine, 30_000);
  useLive(
    live,
    (e) => e.kind === 'task',
    () => {
      queues.reload();
      mine.reload();
    }
  );
  const [notice, setNotice] = useState('');

  const work = async (queue: string) => {
    setNotice('');
    try {
      const task = await client.next(queue);
      if (task) navigate(`/tasks/${task.id}`);
      else {
        setNotice(`Nothing left in ${queue}.`);
        queues.reload();
      }
    } catch (err) {
      setNotice(messageOf(err));
    }
  };

  return (
    <Page title="Tasks" description="Reviews and stuck runs waiting on a person.">
      {notice ? <Alert intent="info">{notice}</Alert> : null}
      {queues.error ? <Alert>{queues.error.message}</Alert> : null}
      <Section title="Assigned to Me" description="Tasks you claimed. Finish these first.">
        {mine.data?.length ? (
          <MyTasksTable tasks={mine.data} />
        ) : mine.loading ? (
          <PageLoading />
        ) : (
          <EmptyText reason="clear">Nothing assigned to you.</EmptyText>
        )}
      </Section>
      <Section title="Queues" description="Pick up the oldest unassigned task in a queue.">
        {queues.data?.length ? (
          <QueuesTable queues={queues.data} onWork={work} />
        ) : queues.loading ? (
          <PageLoading />
        ) : (
          <EmptyText reason="clear">All queues are clear.</EmptyText>
        )}
      </Section>
    </Page>
  );
};
