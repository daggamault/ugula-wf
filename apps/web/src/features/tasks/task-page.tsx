import type { Json } from '@ugula/graph';
import {
  ActivityIcon,
  ArrowRightIcon,
  CircleCheckBigIcon,
  HandIcon,
  InfoIcon,
  ReceiptTextIcon,
  UndoIcon
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatAgo, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { TaskDetail, TasksClient } from './client.ts';
import { ContextView } from './context-view.tsx';
import { humanize, queueInfo } from './queues.ts';
import { SourceReportPanel } from './source-report.tsx';

export type TaskPageProps = {
  client: TasksClient;
  live: Live;
  taskId: string;
};

export type TaskViewProps = {
  task: TaskDetail;
  remaining: number | null;
  source?: ReactNode;
  onComplete: (outcome: string, values: Record<string, Json>) => Promise<void>;
  onAssign: (assign: boolean) => Promise<void>;
  onNext: () => Promise<void>;
};

const FAULT_INTENTS: Record<string, Intent> = {
  retry: 'primary',
  skip: 'warning',
  cancel: 'danger'
};

const FAULT_HELP =
  'Retry the failed step, skip it with the outputs below (and the exec pin to continue from), or cancel the run.';

export const claimIdOf = (task: Pick<TaskDetail, 'source' | 'context'>) => {
  const fromContext =
    task.context && typeof task.context === 'object' && !Array.isArray(task.context)
      ? task.context.claimId
      : null;
  return task.source.claimId ?? (typeof fromContext === 'string' ? fromContext : null);
};

export const queuePath = (queue: string) => `/tasks?queue=${encodeURIComponent(queue)}`;

export const NextUp = ({
  outcome,
  queue,
  remaining,
  onNext
}: {
  outcome: string;
  queue: string;
  remaining: number | null;
  onNext: () => Promise<void>;
}) => {
  const nextRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const label = queueInfo(queue).label;
  useEffect(() => nextRef.current?.focus(), []);
  return (
    <SectionPanel title="Done" accent="primary">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheckBigIcon aria-hidden="true" className="text-success size-5" />“
        {humanize(outcome)}” is recorded and the workflow continues.
      </p>
      <p className="text-surface-fg-muted text-sm">
        {remaining === null
          ? `Checking ${label}…`
          : remaining
            ? `${remaining} more ${remaining === 1 ? 'task is' : 'tasks are'} waiting in ${label}.`
            : `${label} is clear.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {remaining ? (
          <Button
            ref={nextRef}
            isPending={busy}
            onClick={() => {
              setBusy(true);
              void onNext().finally(() => setBusy(false));
            }}
          >
            Next task
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <ButtonLink to={queuePath(queue)} variant="outline">
          Back to Tasks
        </ButtonLink>
      </div>
    </SectionPanel>
  );
};

const Decision = ({
  task,
  onComplete
}: Pick<TaskViewProps, 'task'> & {
  onComplete: (outcome: string, values: Record<string, Json>) => Promise<void>;
}) => {
  const isFault = task.kind === 'fault';
  const [values, setValues] = useState<Record<string, Json>>(() =>
    Object.fromEntries(task.fields.map((f) => [f.name, task.defaults?.[f.name] ?? null]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (outcome: string) => {
    setBusy(outcome);
    try {
      await onComplete(outcome, values);
    } finally {
      setBusy(null);
    }
  };
  return (
    <SectionPanel
      title="Your Decision"
      accent="primary"
      description={isFault ? FAULT_HELP : 'Values come prefilled with what the workflow suggests.'}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        {task.fields.length ? (
          <fieldset disabled={busy !== null} className="flex flex-col gap-5">
            {task.fields.map((f) => (
              <ValueField
                key={f.name}
                id={`field-${f.name}`}
                label={f.label ?? humanize(f.name)}
                type={f.type}
                options={f.options}
                value={values[f.name] ?? null}
                onChange={(value) => setValues({ ...values, [f.name]: value })}
              />
            ))}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {task.outcomes.map((outcome, i) => (
            <Button
              key={outcome}
              intent={isFault ? (FAULT_INTENTS[outcome] ?? 'primary') : 'primary'}
              variant={isFault || i === 0 ? 'solid' : 'outline'}
              isPending={busy === outcome}
              disabledReason={busy && busy !== outcome ? pendingActionMessage : undefined}
              onClick={() => void act(outcome)}
            >
              {humanize(outcome)}
            </Button>
          ))}
        </div>
      </form>
    </SectionPanel>
  );
};

export const TaskView = ({
  task,
  remaining,
  source,
  onComplete,
  onAssign,
  onNext
}: TaskViewProps) => {
  const isFault = task.kind === 'fault';
  const info = queueInfo(task.queue);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const notify = useToast();
  const isUnassigned = task.assignee_id === null;
  const claimId = claimIdOf(task);
  const open = task.status === 'open' && done === null;

  const complete = async (outcome: string, values: Record<string, Json>) => {
    setError('');
    try {
      await onComplete(outcome, values);
      setDone(outcome);
      notify({
        title: `${humanize(outcome)}: ${task.subject ?? task.title}`,
        description: `Recorded in ${info.label}.`,
        action: { label: 'Open task', to: `/tasks/${task.id}` }
      });
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const assign = async () => {
    setAssigning(true);
    setError('');
    try {
      await onAssign(isUnassigned);
      notify({
        intent: 'info',
        title: isUnassigned ? 'Assigned to you' : 'Unassigned',
        description: isUnassigned
          ? 'Nobody else is handed this task while you work on it.'
          : 'Anyone can pick it up now.'
      });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Page
      title={task.subject ?? task.title}
      backTo={queuePath(task.queue)}
      backLabel="Back to Tasks"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge intent={isFault ? 'danger' : 'info'}>{info.label}</Badge>
          {task.subject ? <span>{task.title}</span> : null}
          <span title={formatDateTime(task.created_at)}>
            · waiting since {formatAgo(task.created_at)}
          </span>
        </span>
      }
      actions={
        <>
          {claimId ? (
            <ButtonLink to={`/claims/${claimId}`} variant="outline" size="sm">
              <ReceiptTextIcon aria-hidden="true" className="size-4" />
              Open claim
            </ButtonLink>
          ) : null}
          {isFault ? (
            <ButtonLink to={`/runs/${task.run_id}`} variant="outline" size="sm">
              <ActivityIcon aria-hidden="true" className="size-4" />
              Open the stuck run
            </ButtonLink>
          ) : null}
          {open ? (
            <Button variant="outline" size="sm" isPending={assigning} onClick={() => void assign()}>
              {isUnassigned ? (
                <HandIcon aria-hidden="true" className="size-4" />
              ) : (
                <UndoIcon aria-hidden="true" className="size-4" />
              )}
              {isUnassigned ? 'Assign to me' : 'Unassign'}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {task.instructions ? (
            <aside className="border-info/30 bg-info/10 flex gap-3 rounded-xl border p-4">
              <InfoIcon aria-hidden="true" className="text-info mt-0.5 size-5 shrink-0" />
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-bold">{isFault ? 'What went wrong' : 'What to do'}</h2>
                <p className="text-sm whitespace-pre-line">{task.instructions}</p>
              </div>
            </aside>
          ) : null}
          <SectionPanel
            title="Details"
            description="Everything the workflow knew when it asked for this decision."
          >
            <ContextView label="Task context" value={task.context} />
          </SectionPanel>
          {source}
        </div>
        <div className="flex flex-col gap-6 lg:sticky lg:top-24">
          {done !== null ? (
            <NextUp outcome={done} queue={task.queue} remaining={remaining} onNext={onNext} />
          ) : open ? (
            <Decision key={task.id} task={task} onComplete={complete} />
          ) : (
            <SectionPanel title="Decision" description="How this task was settled.">
              <Alert intent={task.status === 'completed' ? 'success' : 'warning'}>
                {task.status === 'completed'
                  ? `Completed ${formatDateTime(task.completed_at)} as “${humanize(task.resolution?.outcome ?? '')}”.`
                  : 'This task was cancelled.'}
              </Alert>
              {task.resolution ? (
                <ContextView label="Resolution" value={task.resolution.values} />
              ) : null}
            </SectionPanel>
          )}
        </div>
      </div>
    </Page>
  );
};

export const TaskPage = ({ client, live, taskId }: TaskPageProps) => {
  const task = useResource(`task:${taskId}`, () => client.find(taskId));
  const queues = useResource('task-queues', client.queues);
  const runId = task.data?.run_id;
  useLive(
    live,
    (e) => e.kind === 'task' && (e.id === taskId || e.id === null || e.runId === runId),
    () => {
      task.reload();
      queues.reload();
    }
  );
  if (task.error) return <PageFailure message={task.error.message} />;
  if (!task.data) return <PageLoading />;
  const { queue, source } = task.data;
  const waiting = queues.data?.find((q) => q.queue === queue)?.unassigned;
  return (
    <TaskView
      key={taskId}
      task={task.data}
      remaining={queues.data ? (waiting ?? 0) : null}
      source={
        source.reportId ? <SourceReportPanel client={client} reportId={source.reportId} /> : null
      }
      onAssign={async (assign) => {
        await (assign ? client.assign(taskId) : client.unassign(taskId));
        task.reload();
      }}
      onComplete={async (outcome, values) => {
        await client.complete(taskId, outcome, values);
        queues.reload();
      }}
      onNext={async () => {
        const next = await client.next(queue);
        navigate(next ? `/tasks/${next.id}` : queuePath(queue));
      }}
    />
  );
};
