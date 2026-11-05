import { PERMISSION_DESCRIPTIONS } from '@ugula/access';
import type { Json } from '@ugula/graph';
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckBigIcon,
  HandIcon,
  UndoIcon
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { isApiError, messageOf } from '../../shared/api.ts';
import { formatAgo, formatDateTime, formatDay } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { queueInfo } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import { FieldGrid } from '../../shared/ui/field.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { Tooltip } from '../../shared/ui/tooltip.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { backLabelOf, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { TaskDetail, TasksClient } from './client.ts';
import { ContextView } from './context-view.tsx';
import {
  consequenceOf,
  fieldLabel,
  isDestructive,
  missingFor,
  missingReason,
  outcomeIcon,
  outcomeLabel
} from './outcomes.ts';
import { SourceReportPanel } from './source-report.tsx';

type TaskPageProps = {
  client: TasksClient;
  live: Live;
  taskId: string;
  back: string | null;
};

type TaskViewProps = {
  task: TaskDetail;
  back: string;
  remaining: number | null;
  source?: ReactNode;
  onComplete: (outcome: string, values: Record<string, Json>) => Promise<void>;
  onAssign: (assign: boolean) => Promise<void>;
  onNext: () => Promise<void>;
};

type FieldErrors = Readonly<Record<string, string>>;

export const fieldErrorsOf = (err: unknown): FieldErrors => {
  const fields = isApiError(err) && err.status === 422 ? err.body.fields : null;
  return typeof fields === 'object' && fields !== null
    ? Object.fromEntries(
        Object.entries(fields).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : []))
      )
    : {};
};

const FAULT_HELP =
  'Retry the failed step, skip it with the outputs below (and the exec pin to continue from), or cancel the run.';

export const TaskAbout = ({
  task
}: {
  task: Pick<TaskDetail, 'id' | 'title' | 'subject' | 'source'>;
}) => {
  const { claim } = task.source;
  const about = task.subject ? task.title : null;
  if (!claim) return about ?? 'Waiting on a decision';
  return (
    <>
      {about ? `${about} on claim ` : 'On claim '}
      <TextLink to={withBack(`/claims/${claim.id}`, `/tasks/${task.id}`)}>{claim.number}</TextLink>
      {` for ${claim.patient ?? 'a patient not matched yet'}`}
    </>
  );
};

export const backOfTask = (back: string | null) => back ?? '/tasks';

export const NextUp = ({
  outcome,
  queue,
  remaining,
  back,
  onNext
}: {
  outcome: string;
  queue: string;
  remaining: number | null;
  back: string;
  onNext: () => Promise<void>;
}) => {
  const nextRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const label = queueInfo(queue).label;
  const next = async () => {
    setBusy(true);
    try {
      await onNext();
    } catch (err) {
      notify({
        intent: 'danger',
        title: 'Could not open the next task',
        description: messageOf(err)
      });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => nextRef.current?.focus(), []);
  return (
    <SectionPanel
      title="Done"
      description="Your decision is saved, so pick up the next task or go back."
      accent="primary"
    >
      <p className="flex items-center gap-2 text-sm">
        <CircleCheckBigIcon aria-hidden="true" className="text-success size-4 shrink-0" />“
        {outcomeLabel(outcome)}” is recorded and the workflow continues.
      </p>
      <p className="text-surface-fg-muted text-sm">
        {remaining === null
          ? `Checking ${label}…`
          : remaining
            ? `${remaining} more ${remaining === 1 ? 'task is' : 'tasks are'} waiting in ${label}.`
            : `${label} is clear.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {remaining ? (
          <Button ref={nextRef} isPending={busy} onClick={() => void next()}>
            <ArrowRightIcon aria-hidden="true" className="size-4" />
            Next Task
          </Button>
        ) : null}
        <ButtonLink to={back} variant="outline">
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          {backLabelOf(back)}
        </ButtonLink>
      </div>
    </SectionPanel>
  );
};

const intentOf = (outcome: string, isFault: boolean): Intent =>
  isDestructive(outcome) ? 'danger' : isFault && outcome === 'skip' ? 'warning' : 'primary';

const Decision = ({
  task,
  errors,
  onComplete
}: Pick<TaskViewProps, 'task'> & {
  errors: FieldErrors;
  onComplete: (outcome: string, values: Record<string, Json>) => Promise<void>;
}) => {
  const isFault = task.kind === 'fault';
  const can = useCan();
  const unpermitted =
    task.permission && !can(task.permission)
      ? `Completing this task needs a role allowed to: ${PERMISSION_DESCRIPTIONS[task.permission]}`
      : null;
  const [values, setValues] = useState<Record<string, Json>>(() =>
    Object.fromEntries(task.fields.map((f) => [f.name, task.defaults?.[f.name] ?? null]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const act = async (outcome: string) => {
    setBusy(outcome);
    try {
      await onComplete(outcome, values);
    } finally {
      setBusy(null);
    }
  };
  const ConfirmIcon = outcomeIcon(confirming ?? '');
  return (
    <SectionPanel
      title="Your Decision"
      accent="primary"
      description={isFault ? FAULT_HELP : 'Values come prefilled with what the workflow suggests.'}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        {task.fields.length ? (
          <fieldset disabled={busy !== null}>
            <FieldGrid>
              {task.fields.map((f) => (
                <ValueField
                  key={f.name}
                  id={`field-${f.name}`}
                  label={fieldLabel(f)}
                  type={f.type}
                  options={f.options}
                  isRequired={Boolean(f.required?.length)}
                  format={f.format}
                  min={f.min}
                  max={f.max}
                  error={errors[f.name]}
                  value={values[f.name] ?? null}
                  onChange={(value) => setValues({ ...values, [f.name]: value })}
                />
              ))}
            </FieldGrid>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {task.outcomes.map((outcome, i) => {
            const Icon = outcomeIcon(outcome);
            const intent = intentOf(outcome, isFault);
            return (
              <Button
                key={outcome}
                intent={intent}
                variant={isFault || (i === 0 && intent === 'primary') ? 'solid' : 'outline'}
                isPending={busy === outcome}
                disabledReason={
                  unpermitted ??
                  (busy && busy !== outcome
                    ? pendingActionMessage
                    : missingReason(missingFor(task.fields, values, outcome)))
                }
                onClick={() =>
                  isDestructive(outcome) ? setConfirming(outcome) : void act(outcome)
                }
              >
                <Icon aria-hidden="true" className="size-4" />
                {outcomeLabel(outcome)}
              </Button>
            );
          })}
        </div>
      </form>
      <ConfirmDialog
        open={confirming !== null}
        title={`${outcomeLabel(confirming ?? '')}?`}
        intent="danger"
        confirmLabel={outcomeLabel(confirming ?? '')}
        confirmIcon={ConfirmIcon}
        dismissLabel="Keep"
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const outcome = confirming;
          setConfirming(null);
          if (outcome) void act(outcome);
        }}
      >
        {consequenceOf(confirming ?? '')}
      </ConfirmDialog>
    </SectionPanel>
  );
};

export const TaskView = ({
  task,
  back,
  remaining,
  source,
  onComplete,
  onAssign,
  onNext
}: TaskViewProps) => {
  const isFault = task.kind === 'fault';
  const info = queueInfo(task.queue);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const notify = useToast();
  const isUnassigned = task.assignee_id === null;
  const open = task.status === 'open' && done === null;

  const complete = async (outcome: string, values: Record<string, Json>) => {
    setError('');
    setErrors({});
    try {
      await onComplete(outcome, values);
      setDone(outcome);
      notify({
        title: `${outcomeLabel(outcome)}: ${task.subject ?? task.title}`,
        description: `Recorded in ${info.label}.`
      });
    } catch (err) {
      setError(messageOf(err));
      setErrors(fieldErrorsOf(err));
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
      backTo={back}
      backLabel={backLabelOf(back)}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge intent={isFault ? 'danger' : 'info'}>{info.label}</Badge>
          <span>
            <TaskAbout task={task} />, opened{' '}
            <Tooltip label={formatDateTime(task.created_at)} side="bottom">
              <time dateTime={task.created_at}>
                {formatAgo(task.created_at)}
                <span className="sr-only"> ({formatDateTime(task.created_at)})</span>
              </time>
            </Tooltip>
            {task.due_at ? (
              <>
                , due <time dateTime={task.due_at}>{formatDay(task.due_at)}</time>
              </>
            ) : null}
            .
          </span>
        </span>
      }
      actions={
        <>
          {isFault ? (
            <ButtonLink to={`/runs/${task.run_id}`} variant="outline">
              <ActivityIcon aria-hidden="true" className="size-4" />
              Open Run
            </ButtonLink>
          ) : null}
          {open ? (
            <Button variant="outline" isPending={assigning} onClick={() => void assign()}>
              {isUnassigned ? (
                <HandIcon aria-hidden="true" className="size-4" />
              ) : (
                <UndoIcon aria-hidden="true" className="size-4" />
              )}
              {isUnassigned ? 'Assign to Me' : 'Unassign'}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {task.instructions ? (
            <Alert intent="info">
              <span className="flex flex-col gap-1">
                <strong className="font-semibold">
                  {isFault ? 'What Went Wrong' : 'What to Do'}
                </strong>
                <span className="whitespace-pre-line">{task.instructions}</span>
              </span>
            </Alert>
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
            <NextUp
              outcome={done}
              queue={task.queue}
              remaining={remaining}
              back={back}
              onNext={onNext}
            />
          ) : open ? (
            <Decision key={task.id} task={task} errors={errors} onComplete={complete} />
          ) : (
            <SectionPanel title="Decision" description="How this task was settled.">
              <Alert intent={task.status === 'completed' ? 'success' : 'warning'}>
                {task.status === 'completed'
                  ? `Completed ${formatDateTime(task.completed_at)} as “${outcomeLabel(task.resolution?.outcome ?? '')}”.`
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

export const TaskPage = ({ client, live, taskId, back }: TaskPageProps) => {
  const task = useResource(`task:${taskId}`, (signal) => client.find(taskId, signal));
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
  const backTo = backOfTask(back);
  const waiting = queues.data?.find((q) => q.queue === queue)?.unassigned;
  return (
    <TaskView
      key={taskId}
      task={task.data}
      back={backTo}
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
        if (!next) navigate(backTo);
        else if (backTo.startsWith('/claims/')) navigate(`/tasks/${next.id}`);
        else navigate(withBack(`/tasks/${next.id}`, backTo));
      }}
    />
  );
};
