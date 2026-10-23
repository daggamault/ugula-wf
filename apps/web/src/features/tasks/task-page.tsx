import type { Json } from '@ugula/graph';
import { ExternalLinkIcon, HandIcon, UndoIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatDateTime } from '../../shared/format.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink, type ButtonVariant } from '../../shared/ui/button.tsx';
import { JsonView } from '../../shared/ui/json-view.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { ValueField } from '../../shared/ui/value-field.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { TaskDetail, TasksClient } from './client.ts';

export type TaskPageProps = {
  client: TasksClient;
  taskId: string;
};

export type TaskViewProps = {
  task: TaskDetail;
  onComplete: (outcome: string, values: Record<string, Json>) => Promise<void>;
  onAssign: (claim: boolean) => Promise<void>;
};

const FAULT_VARIANTS: Record<string, ButtonVariant> = {
  retry: 'primary',
  skip: 'warning',
  cancel: 'danger'
};

const FAULT_HELP =
  'Retry the failed step, skip it with the outputs below (and the exec pin to continue from), or cancel the run.';

const labelOf = (outcome: string) => outcome.charAt(0).toUpperCase() + outcome.slice(1);

export const TaskView = ({ task, onComplete, onAssign }: TaskViewProps) => {
  const isFault = task.kind === 'fault';
  const open = task.status === 'open';
  const [values, setValues] = useState<Record<string, Json>>(() =>
    Object.fromEntries(task.fields.map((f) => [f.name, task.defaults?.[f.name] ?? null]))
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };
  const pendingReason = busy ? 'Wait for this to finish.' : undefined;
  const isUnassigned = task.assignee_id === null;

  return (
    <Page
      title={task.title}
      backTo="/tasks"
      backLabel="Back to Tasks"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={isFault ? 'danger' : 'info'}>{isFault ? 'Stuck run' : 'Review'}</Badge>
          <span>{task.queue}</span>
          <span>· {formatDateTime(task.created_at)}</span>
        </span>
      }
      actions={
        <>
          <ButtonLink to={`/runs/${task.run_id}`} variant="secondary">
            <ExternalLinkIcon aria-hidden="true" className="size-4" />
            Open run
          </ButtonLink>
          {open ? (
            <Button
              variant="secondary"
              isPending={busy === 'assign'}
              disabledReason={busy && busy !== 'assign' ? pendingReason : undefined}
              onClick={() => act('assign', () => onAssign(isUnassigned))}
            >
              {isUnassigned ? (
                <HandIcon aria-hidden="true" className="size-4" />
              ) : (
                <UndoIcon aria-hidden="true" className="size-4" />
              )}
              {isUnassigned ? 'Claim' : 'Release'}
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <SectionPanel title={isFault ? 'What Went Wrong' : 'Context'}>
          {task.instructions ? (
            <p className="text-sm whitespace-pre-line">{task.instructions}</p>
          ) : null}
          <JsonView label="Task context" value={task.context} />
        </SectionPanel>
        <SectionPanel
          title="Decision"
          accent={open ? 'primary' : 'none'}
          description={open && isFault ? FAULT_HELP : undefined}
        >
          {open ? (
            <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
              {task.fields.length ? (
                <fieldset disabled={busy !== null} className="flex flex-col gap-5">
                  {task.fields.map((f) => (
                    <ValueField
                      key={f.name}
                      id={`field-${f.name}`}
                      label={f.label ?? f.name}
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
                    variant={
                      isFault
                        ? (FAULT_VARIANTS[outcome] ?? 'secondary')
                        : i === 0
                          ? 'primary'
                          : 'secondary'
                    }
                    isPending={busy === outcome}
                    disabledReason={busy && busy !== outcome ? pendingReason : undefined}
                    onClick={() => act(outcome, () => onComplete(outcome, values))}
                  >
                    {labelOf(outcome)}
                  </Button>
                ))}
              </div>
            </form>
          ) : (
            <>
              <Alert tone={task.status === 'completed' ? 'success' : 'warning'}>
                {task.status === 'completed'
                  ? `Completed ${formatDateTime(task.completed_at)} as “${task.resolution?.outcome ?? ''}”.`
                  : 'This task was cancelled.'}
              </Alert>
              {task.resolution ? (
                <JsonView label="Resolution" value={task.resolution.values} />
              ) : null}
            </>
          )}
        </SectionPanel>
      </div>
    </Page>
  );
};

export const TaskPage = ({ client, taskId }: TaskPageProps) => {
  const task = useResource(`task:${taskId}`, () => client.find(taskId));
  if (task.error) return <PageFailure message={task.error.message} />;
  if (!task.data) return <PageLoading />;
  const { queue } = task.data;
  return (
    <TaskView
      key={taskId}
      task={task.data}
      onAssign={async (claim) => {
        await (claim ? client.claim(taskId) : client.release(taskId));
        task.reload();
      }}
      onComplete={async (outcome, values) => {
        await client.complete(taskId, outcome, values);
        const next = await client.next(queue);
        navigate(next ? `/tasks/${next.id}` : '/tasks');
      }}
    />
  );
};
