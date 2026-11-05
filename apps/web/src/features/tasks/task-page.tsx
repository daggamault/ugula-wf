import { PERMISSION_DESCRIPTIONS } from '@ugula/access';
import type { Json } from '@ugula/graph';
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  HandIcon,
  UndoIcon
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useCan } from '../../shared/access.tsx';
import { isApiError, messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatAgo, formatDateTime, formatDay } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { queueInfo } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { Collapse } from '../../shared/ui/collapse.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid } from '../../shared/ui/field.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Tabs } from '../../shared/ui/tabs.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { Tooltip } from '../../shared/ui/tooltip.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { backLabelOf, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { TaskDetail, TasksClient } from './client.ts';
import { ContextView } from './context-view.tsx';
import { encounterFactsOf, type Mismatch, mismatchesOf } from './encounter-check.ts';
import {
  consequenceOf,
  fieldLabel,
  isDestructive,
  missingFor,
  missingReason,
  outcomeHint,
  outcomeIcon,
  outcomeLabel
} from './outcomes.ts';
import { SourceReportView } from './source-report.tsx';
import { ClaimFacts, PatientFacts, TaskIssue } from './task-brief.tsx';
import { ChangeList, changesOf, FieldWas } from './task-changes.tsx';

export const TASK_TABS = ['claim', 'encounter', 'patient'] as const;

export type TaskTab = (typeof TASK_TABS)[number];

export const taskTabOf = (value: string | null): TaskTab =>
  TASK_TABS.find((t) => t === value) ?? 'claim';

const TAB_LABELS: Readonly<Record<TaskTab, string>> = {
  claim: 'Claim',
  encounter: 'Encounter',
  patient: 'Patient'
};

export type FollowUp = { title: string; href: string };

const FOLLOW_UP_TRIES = 40;
const FOLLOW_UP_WAIT_MS = 500;

type TaskPageProps = {
  client: TasksClient;
  live: Live;
  taskId: string;
  back: string | null;
  tab?: TaskTab;
};

type TaskViewProps = {
  task: TaskDetail;
  back: string;
  remaining: number | null;
  tab?: TaskTab;
  tabHref?: (tab: TaskTab) => string;
  findFollowUp?: (() => Promise<FollowUp | null>) | undefined;
  mismatches?: readonly Mismatch[];
  source?: ReactNode;
  onComplete: (outcome: string, values: Record<string, Json>) => Promise<void>;
  onAssign: (assign: boolean) => Promise<void>;
  onNext: () => Promise<void>;
  upload?: Upload | undefined;
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
    <SectionPanel
      title="Done"
      description="Your decision is saved, so pick up the next task or go back."
      accent="primary"
    >
      <p className="flex items-center gap-2 text-sm">
        <CircleCheckBigIcon aria-hidden="true" className="text-success size-4 shrink-0" />“
        {outcomeLabel(outcome)}” is recorded and the workflow continues.
      </p>
      {followUp ? (
        <div className="border-primary/40 bg-primary/5 flex flex-col gap-3 rounded-xl border p-3">
          <p className="text-sm">
            <span className="text-surface-fg-muted">Up next on this claim: </span>
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
    </SectionPanel>
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
        : task.fields.length
          ? 'Fill in what is needed, then choose an option.'
          : 'Choose an option. Each one says what happens next.';

const Decision = ({
  task,
  errors,
  upload,
  onComplete
}: Pick<TaskViewProps, 'task' | 'upload'> & {
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
  const showChanges = task.fields.length > 0 && task.prefill === 'current';
  const changes = showChanges ? changesOf(task.fields, task.defaults, values) : [];
  return (
    <SectionPanel
      title="Your Decision"
      accent="primary"
      description={decisionHelp(task, showChanges)}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
        {task.fields.length ? (
          <fieldset disabled={busy !== null}>
            <FieldGrid>
              {task.fields.map((f) => {
                const change = changes.find((c) => c.field.name === f.name);
                return (
                  <div key={f.name} className="flex min-w-0 flex-col gap-1.5">
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
        ) : null}
        {showChanges ? <ChangeList changes={changes} /> : null}
        <ul aria-label="Options" className="flex flex-col gap-3">
          {task.outcomes.map((outcome, i) => {
            const Icon = outcomeIcon(outcome);
            const intent = intentOf(outcome, isFault);
            const hint = outcomeHint(task, outcome);
            const hintId = `outcome-${task.id}-${outcome}`;
            return (
              <li key={outcome} className="flex flex-col gap-1">
                <Button
                  isBlock
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
                    isDestructive(outcome, task.kind) ? setConfirming(outcome) : void act(outcome)
                  }
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {outcomeLabel(outcome)}
                </Button>
                {hint ? (
                  <p id={hintId} className="text-surface-fg-muted px-1 text-xs">
                    {hint}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
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
    </SectionPanel>
  );
};

// Open by default: reviews keep what supports a suggestion here.
const WorkflowDetails = ({ context }: { context: Json }) => {
  const [isOpen, setOpen] = useState(true);
  const id = useId();
  return (
    <SectionPanel
      title="Workflow Details"
      description="What the workflow passed to this task, for reference."
      actions={
        <Button
          variant="outline"
          size="sm"
          aria-expanded={isOpen}
          aria-controls={id}
          onClick={() => setOpen(!isOpen)}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={classNamesOf('size-4 transition-transform', isOpen && 'rotate-180')}
          />
          {isOpen ? 'Hide' : 'Show'}
        </Button>
      }
    >
      <Collapse id={id} isOpen={isOpen}>
        <ContextView label="Task context" value={context} hideNotices />
      </Collapse>
    </SectionPanel>
  );
};

export const TaskView = ({
  task,
  back,
  remaining,
  tab = 'claim',
  tabHref,
  findFollowUp,
  mismatches = [],
  source,
  onComplete,
  onAssign,
  onNext,
  upload
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
  const { claim } = task.source;
  const hasTabs = claim !== null || source != null || task.source.patient !== null;
  const encounterHref = source != null ? (tabHref?.('encounter') ?? '?tab=encounter') : undefined;

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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="order-1 min-w-0 lg:col-start-1 lg:row-start-1">
          <TaskIssue task={task} />
        </div>
        <div className="order-3 flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
          {hasTabs ? (
            <>
              <Tabs
                label="Task data"
                tabs={TASK_TABS.map((t) => ({
                  label: TAB_LABELS[t],
                  href: tabHref?.(t) ?? `?tab=${t}`,
                  isSelected: t === tab
                }))}
              />
              {tab === 'encounter' ? (
                (source ?? (
                  <SectionPanel title="Encounter" description="What the crew documented.">
                    <EmptyText>No patient care report is linked to this task.</EmptyText>
                  </SectionPanel>
                ))
              ) : tab === 'patient' ? (
                <PatientFacts
                  patient={task.source.patient}
                  payers={claim?.payers ?? null}
                  taskId={task.id}
                  mismatches={mismatches}
                  encounterHref={encounterHref}
                />
              ) : claim ? (
                <ClaimFacts
                  claim={claim}
                  taskId={task.id}
                  mismatches={mismatches}
                  encounterHref={encounterHref}
                />
              ) : (
                <SectionPanel title="Claim" description="What is billed.">
                  <EmptyText>This task is not about a claim yet.</EmptyText>
                </SectionPanel>
              )}
              <WorkflowDetails context={task.context} />
            </>
          ) : (
            <WorkflowDetails context={task.context} />
          )}
        </div>
        <div
          className={classNamesOf(
            'flex flex-col gap-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1',
            task.fields.length && open ? 'order-2' : 'order-4'
          )}
        >
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
              onComplete={complete}
            />
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

export const TaskPage = ({ client, live, taskId, back, tab = 'claim' }: TaskPageProps) => {
  const task = useResource(`task:${taskId}`, (signal) => client.find(taskId, signal));
  const queues = useResource('task-queues', client.queues);
  const runId = task.data?.run_id;
  const backTo = backOfTask(back);
  const reportId = task.data?.source.reportId ?? null;
  const report = useResource(`source-report:${reportId ?? 'none'}`, () =>
    reportId ? client.report(reportId) : Promise.resolve(null)
  );
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
  if (task.error) return <PageFailure message={task.error.message} />;
  if (!task.data) return <PageLoading />;
  const { queue, source } = task.data;
  const encounter = report.data ? encounterFactsOf(report.data.data) : null;
  const waiting = queues.data?.find((q) => q.queue === queue)?.unassigned;
  return (
    <TaskView
      key={taskId}
      task={task.data}
      back={backTo}
      remaining={queues.data ? (waiting ?? 0) : null}
      tab={tab}
      tabHref={(t) => {
        const to = `/tasks/${taskId}?tab=${t}`;
        return back === null ? to : withBack(to, back);
      }}
      findFollowUp={findFollowUp}
      mismatches={encounter && source.claim ? mismatchesOf(source.claim, encounter) : []}
      source={
        source.reportId === null ? null : report.error ? (
          <Alert>{report.error.message}</Alert>
        ) : report.data ? (
          <SourceReportView source={report.data} />
        ) : (
          <PageLoading />
        )
      }
      upload={(file) => client.uploadFile(taskId, file)}
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
