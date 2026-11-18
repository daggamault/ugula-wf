import { PERMISSION_DESCRIPTIONS } from '@ugula/access';
import { type CodeSet, isCodeSet } from '@ugula/billing';
import { type FieldSpec, isTextType, type Json } from '@ugula/graph';
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckBigIcon,
  HandIcon,
  UndoIcon
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { isApiError, messageOf } from '../../shared/api.ts';
import { CodeField } from '../../shared/claims/code-field.tsx';
import type { CodesClient } from '../../shared/codes.ts';
import { formatAgo, formatDateTime, formatDay } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate, useUnsavedChanges } from '../../shared/router.tsx';
import {
  consequenceOf,
  fieldLabel,
  fieldsByOutcome,
  isDestructive,
  missingFor,
  missingReason,
  outcomeHint,
  outcomeIcon,
  outcomeLabel
} from '../../shared/task-outcomes.ts';
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
import { Textarea } from '../../shared/ui/textarea.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { Tooltip } from '../../shared/ui/tooltip.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { backLabelOf, withBack } from '../../shared/url-state.ts';
import { loadFailure, refreshFailure, useResource } from '../../shared/use-resource.ts';
import type { TaskDetail, TasksClient } from './client.ts';
import { ContextView } from './context-view.tsx';
import { TaskIssue } from './task-brief.tsx';
import { ChangeList, changesOf, FieldWas } from './task-changes.tsx';

type FollowUp = { title: string; href: string };

const DecisionSection = ({ title, children }: { title: string; children: ReactNode }) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h3 id={id} className="text-base font-bold">
        {title}
      </h3>
      {children}
    </section>
  );
};

export const isCodeField = (f: FieldSpec): f is FieldSpec & { codeSet: CodeSet } =>
  isCodeSet(f.codeSet) &&
  (isTextType(f.type) ||
    (typeof f.type === 'object' && 'list' in f.type && isTextType(f.type.list)));

const FOLLOW_UP_TRIES = 40;
const FOLLOW_UP_WAIT_MS = 500;

type TaskPageProps = {
  client: TasksClient;
  codes: CodesClient;
  live: Live;
  taskId: string;
  back: string | null;
};

type TaskViewProps = {
  task: TaskDetail;
  back: string;
  remaining: number | null;
  findFollowUp?: (() => Promise<FollowUp | null>) | undefined;
  onComplete: (outcome: string, values: Record<string, Json>, note: string) => Promise<void>;
  onAssign: (assign: boolean) => Promise<void>;
  onNext: () => Promise<void>;
  upload?: Upload | undefined;
  codes?: CodesClient | undefined;
  refreshError?: string;
};

type Upload = (file: File) => Promise<{ file: Json; name: string }>;

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

export const backOfTask = (back: string | null) => back ?? '/tasks';

export const NextUp = ({
  outcome,
  queue,
  remaining,
  back,
  onNext,
  findFollowUp
}: {
  outcome: string;
  queue: string;
  remaining: number | null;
  back: string;
  onNext: () => Promise<void>;
  findFollowUp?: (() => Promise<FollowUp | null>) | undefined;
}) => {
  const nextRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  useEffect(() => {
    if (!findFollowUp) return;
    let stopped = false;
    void (async () => {
      for (let i = 0; i < FOLLOW_UP_TRIES && !stopped; i++) {
        const found = await findFollowUp().catch(() => null);
        if (found) {
          if (!stopped) setFollowUp(found);
          return;
        }
        await new Promise((r) => setTimeout(r, FOLLOW_UP_WAIT_MS));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [findFollowUp]);
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
    <DecisionSection title="Done">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheckBigIcon aria-hidden="true" className="text-success size-4 shrink-0" />“
        {outcomeLabel(outcome)}” is recorded and the workflow continues.
      </p>
      {followUp ? (
        <div className="border-primary/40 bg-primary/5 flex flex-col gap-3 rounded-xl border p-3">
          <p className="text-sm">
            <span className="text-surface-fg-muted">Up next in this run: </span>
            <span className="font-semibold">{followUp.title}</span>
          </p>
          <ButtonLink to={followUp.href}>
            <ArrowRightIcon aria-hidden="true" className="size-4" />
            Open {followUp.title}
          </ButtonLink>
        </div>
      ) : null}
      <p className="text-surface-fg-muted text-sm">
        {remaining === null
          ? `Checking ${label}…`
          : remaining
            ? `${remaining} more ${remaining === 1 ? 'task is' : 'tasks are'} waiting in ${label}.`
            : `${label} is clear.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {remaining ? (
          <Button
            ref={nextRef}
            variant={followUp ? 'outline' : 'solid'}
            isPending={busy}
            onClick={() => void next()}
          >
            <ArrowRightIcon aria-hidden="true" className="size-4" />
            Next Task
          </Button>
        ) : null}
        <ButtonLink to={back} variant="outline">
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          {backLabelOf(back)}
        </ButtonLink>
      </div>
    </DecisionSection>
  );
};

const intentOf = (outcome: string, isFault: boolean): Intent =>
  isDestructive(outcome, isFault ? 'fault' : 'task')
    ? 'danger'
    : isFault && outcome === 'skip'
      ? 'warning'
      : 'primary';

const decisionHelp = (task: TaskDetail, showChanges: boolean) =>
  task.kind === 'fault'
    ? FAULT_HELP
    : showChanges
      ? 'Fields start with the current values. Change what is wrong, check your changes, then choose an option.'
      : task.fields.length && task.prefill === 'suggested'
        ? 'Fields start with what the workflow suggests. Confirm or change them, then choose an option.'
        : null;

const Decision = ({
  task,
  errors,
  upload,
  codes,
  onComplete
}: Pick<TaskViewProps, 'task' | 'upload' | 'codes'> & {
  errors: FieldErrors;
  onComplete: (outcome: string, values: Record<string, Json>, note: string) => Promise<void>;
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
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const act = async (outcome: string) => {
    setBusy(outcome);
    try {
      await onComplete(outcome, values, note.trim());
    } finally {
      setBusy(null);
    }
  };
  const ConfirmIcon = outcomeIcon(confirming ?? '');
  const showChanges = task.fields.length > 0 && task.prefill === 'current';
  const edited = changesOf(task.fields, task.defaults, values);
  const changes = showChanges ? edited : [];
  useUnsavedChanges(edited.length > 0);
  const { shared, own } = fieldsByOutcome(task.fields, task.outcomes);
  const help = decisionHelp(task, showChanges);
  const fieldGrid = (fields: readonly FieldSpec[]) =>
    fields.length ? (
      <fieldset disabled={busy !== null}>
        <FieldGrid>
          {fields.map((f) => {
            const change = changes.find((c) => c.field.name === f.name);
            return (
              <div key={f.name} className="flex min-w-0 flex-col gap-1.5">
                {codes && isCodeField(f) ? (
                  <CodeField
                    id={`field-${f.name}`}
                    label={fieldLabel(f)}
                    codeSet={f.codeSet}
                    codeList={f.codeList ?? null}
                    codes={codes}
                    isMultiple={f.type !== 'string'}
                    isRequired={Boolean(f.required?.length)}
                    error={errors[f.name]}
                    value={values[f.name] ?? null}
                    onChange={(value) => setValues({ ...values, [f.name]: value })}
                  />
                ) : (
                  <ValueField
                    id={`field-${f.name}`}
                    label={fieldLabel(f)}
                    type={f.type}
                    options={f.options}
                    isRequired={Boolean(f.required?.length)}
                    format={f.format}
                    min={f.min}
                    max={f.max}
                    error={errors[f.name]}
                    upload={upload}
                    value={values[f.name] ?? null}
                    onChange={(value) => setValues({ ...values, [f.name]: value })}
                  />
                )}
                {change ? (
                  <FieldWas
                    field={f}
                    was={change.was}
                    onReset={() => setValues({ ...values, [f.name]: change.was })}
                  />
                ) : null}
              </div>
            );
          })}
        </FieldGrid>
      </fieldset>
    ) : null;
  return (
    <DecisionSection title="Your Decision">
      {help ? <p className="text-surface-fg-muted text-sm">{help}</p> : null}
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        {fieldGrid(shared)}
        {showChanges ? <ChangeList changes={changes} /> : null}
        <Textarea
          id={`task-${task.id}-note`}
          label="Note (Optional)"
          hint="Saved with your decision."
          maxLength={1000}
          rows={2}
          disabled={busy !== null}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <ol aria-label="Options" className="flex flex-col gap-4">
          {task.outcomes.map((outcome, i) => {
            const Icon = outcomeIcon(outcome);
            const intent = intentOf(outcome, isFault);
            const hint = outcomeHint(task, outcome);
            const hintId = `outcome-${task.id}-${outcome}`;
            return (
              <li key={outcome} className="flex flex-col gap-4">
                {i ? (
                  <p
                    aria-hidden="true"
                    className="text-surface-fg-muted before:bg-border after:bg-border flex items-center gap-3 text-xs font-semibold tracking-wide uppercase before:h-px before:flex-1 after:h-px after:flex-1"
                  >
                    or
                  </p>
                ) : null}
                <div className="flex flex-col gap-3">
                  {hint ? (
                    <p id={hintId} className="text-sm">
                      {hint}
                    </p>
                  ) : null}
                  {fieldGrid(own(outcome))}
                  <div className="flex">
                    <Button
                      name="outcome"
                      value={outcome}
                      intent={intent}
                      variant={isFault || (i === 0 && intent === 'primary') ? 'solid' : 'outline'}
                      isPending={busy === outcome}
                      aria-describedby={hint ? hintId : undefined}
                      disabledReason={
                        unpermitted ??
                        (busy && busy !== outcome
                          ? pendingActionMessage
                          : missingReason(missingFor(task.fields, values, outcome)))
                      }
                      onClick={() =>
                        isDestructive(outcome, task.kind)
                          ? setConfirming(outcome)
                          : void act(outcome)
                      }
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      {outcomeLabel(outcome)}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
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
        {consequenceOf(task, confirming ?? '')}
      </ConfirmDialog>
    </DecisionSection>
  );
};

const WorkflowDetails = ({ context }: { context: Json }) => (
  <SectionPanel title="Workflow Details">
    <ContextView label="Task Context" value={context} hideNotices />
  </SectionPanel>
);

export const TaskView = ({
  task,
  back,
  remaining,
  findFollowUp,
  onComplete,
  onAssign,
  onNext,
  upload,
  codes,
  refreshError = ''
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

  const complete = async (outcome: string, values: Record<string, Json>, note: string) => {
    setError('');
    setErrors({});
    try {
      await onComplete(outcome, values, note);
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
            {task.subject ? task.title : 'Waiting on a decision'}, opened{' '}
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
      {refreshError ? <Alert>{refreshError}</Alert> : null}
      <TaskIssue task={task}>
        {done !== null ? (
          <NextUp
            outcome={done}
            queue={task.queue}
            remaining={remaining}
            back={back}
            onNext={onNext}
            findFollowUp={findFollowUp}
          />
        ) : open ? (
          <Decision
            key={task.id}
            task={task}
            errors={errors}
            upload={upload}
            codes={codes}
            onComplete={complete}
          />
        ) : (
          <DecisionSection title="Decision">
            <Alert intent={task.status === 'completed' ? 'success' : 'warning'}>
              {task.status === 'completed'
                ? `Completed ${formatDateTime(task.completed_at)} as “${outcomeLabel(task.resolution?.outcome ?? '')}”.`
                : 'This task was cancelled.'}
            </Alert>
            {task.resolution?.note ? (
              <p className="text-sm whitespace-pre-line">{task.resolution.note}</p>
            ) : null}
            {task.resolution ? (
              <ContextView label="Resolution" value={task.resolution.values} />
            ) : null}
          </DecisionSection>
        )}
      </TaskIssue>
      <WorkflowDetails context={task.context} />
    </Page>
  );
};

export const TaskPage = ({ client, codes, live, taskId, back }: TaskPageProps) => {
  const task = useResource(`task:${taskId}`, (signal) => client.find(taskId, signal));
  const queues = useResource('task-queues', client.queues);
  const runId = task.data?.run_id;
  const backTo = backOfTask(back);
  const findFollowUp = useCallback(async (): Promise<FollowUp | null> => {
    if (!runId) return null;
    const next = await client.followUp(runId, taskId);
    return next ? { title: next.title, href: withBack(`/tasks/${next.id}`, backTo) } : null;
  }, [client, runId, taskId, backTo]);
  useLive(
    live,
    (e) => e.kind === 'task' && (e.id === taskId || e.id === null || e.runId === runId),
    () => {
      task.reload();
      queues.reload();
    }
  );
  const failed = loadFailure(task);
  if (failed) return <PageFailure message={failed.message} />;
  if (!task.data) return <PageLoading />;
  const { queue } = task.data;
  const waiting = queues.data?.find((q) => q.queue === queue)?.unassigned;
  return (
    <TaskView
      key={taskId}
      task={task.data}
      back={backTo}
      remaining={queues.data ? (waiting ?? 0) : null}
      findFollowUp={findFollowUp}
      upload={(file) => client.uploadFile(taskId, file)}
      refreshError={refreshFailure(task)}
      codes={codes}
      onAssign={async (assign) => {
        await (assign ? client.assign(taskId) : client.unassign(taskId));
        task.reload();
      }}
      onComplete={async (outcome, values, note) => {
        await client.complete(taskId, outcome, values, note);
        queues.reload();
      }}
      onNext={async () => {
        const next = await client.next(queue);
        if (!next) navigate(backTo);
        else navigate(withBack(`/tasks/${next.id}`, backTo));
      }}
    />
  );
};
