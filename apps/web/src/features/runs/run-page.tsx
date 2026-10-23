import { ChevronRightIcon, CircleStopIcon, WorkflowIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDateTime } from '../../shared/format.ts';
import { createCatalog } from '../../shared/graph/catalog.ts';
import { GraphCanvas } from '../../shared/graph/graph-canvas.tsx';
import { type Live, useLive } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { JsonView } from '../../shared/ui/json-view.tsx';
import { PageFailure, PageLoading, WorkspaceHeader } from '../../shared/ui/page.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import {
  isFinished,
  type RunDetail,
  type RunGraph,
  type RunStep,
  type RunsClient
} from './client.ts';
import { graphAt, pathOf, runsStartedBy, statusAt } from './inspect.ts';
import { NodeExecutions } from './node-executions.tsx';
import { RunStatusBadge } from './run-status-badge.tsx';

export type RunPageProps = {
  client: RunsClient;
  live: Live;
  runId: string;
};

export type RunViewProps = {
  detail: RunDetail;
  graphs: readonly RunGraph[];
  steps: readonly RunStep[];
  onCancel: () => Promise<void>;
};

const crumbClass = classNamesOf(
  'hover:bg-surface-fg/6 hover:text-surface-fg last:text-surface-fg rounded-md px-2 py-1 font-mono text-xs last:font-semibold',
  interactiveClasses
);

const panelHeading = 'text-surface-fg-muted text-xs font-semibold tracking-wide uppercase';

export const RunView = ({ detail, graphs, steps, onCancel }: RunViewProps) => {
  const { run, children, childCount, tasks } = detail;
  const [stack, setStack] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const catalog = useMemo(
    () =>
      createCatalog({
        graphs: graphs.map((g) => ({ type: g.key, version: g.version, definition: g.definition }))
      }),
    [graphs]
  );
  const root = graphs.find((g) => g.key === run.key && g.version === run.version)?.definition;
  const def = root ? graphAt(root, stack, catalog) : undefined;
  const path = pathOf(stack);
  const status = useMemo(() => statusAt(steps, run.state, path), [steps, run.state, path]);
  const node = def?.nodes.find((n) => n.id === selected);
  const active = !isFinished(run.status);
  const openTasks = tasks.filter((t) => t.status === 'open');
  const startedBy = (id: string) => runsStartedBy(detail, steps, path, id);
  const open = (id: string) => {
    const inst = def?.nodes.find((n) => n.id === id);
    if (!inst) return;
    if (catalog.opensAs(inst) === 'graph') {
      setStack([...stack, id]);
      setSelected(null);
      return;
    }
    const [only, ...more] = startedBy(id);
    if (only && !more.length) navigate(`/runs/${only.id}`);
    else setSelected(id);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <WorkspaceHeader
        backTo="/runs"
        backLabel="Back to Runs"
        title={
          <>
            {run.name} <span className="text-surface-fg-muted font-normal">v{run.version}</span>
            <RunStatusBadge status={run.status} />
          </>
        }
        description={
          <>
            Started {formatDateTime(run.created_at)}
            {run.completed_at ? ` · Finished ${formatDateTime(run.completed_at)}` : ''}
            {run.parent_id ? (
              <>
                {' · '}
                <TextLink to={`/runs/${run.parent_id}`}>Parent run</TextLink>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <ButtonLink
              to={`/workflows/${run.graph_id}?version=${run.version}`}
              variant="outline"
              size="sm"
            >
              <WorkflowIcon aria-hidden="true" className="size-4" />
              Open workflow
            </ButtonLink>
            {active ? (
              <Button intent="danger" size="sm" onClick={() => setConfirming(true)}>
                <CircleStopIcon aria-hidden="true" className="size-4" />
                Cancel run
              </Button>
            ) : null}
          </>
        }
      />
      {error || run.error || openTasks.length ? (
        <div className="flex flex-col gap-2 px-4 pt-3">
          {error ? <Alert>{error}</Alert> : null}
          {run.error ? <Alert>{run.error.message}</Alert> : null}
          {openTasks.length ? (
            <Alert intent="warning">
              {openTasks.some((t) => t.kind === 'fault') ? 'Needs attention: ' : 'Waiting on '}
              {openTasks.map((t, i) => (
                <span key={t.id}>
                  {i ? ', ' : ''}
                  <TextLink to={`/tasks/${t.id}`}>{t.title}</TextLink>
                </span>
              ))}
            </Alert>
          ) : null}
        </div>
      ) : null}
      <nav
        aria-label="Graph path"
        className="text-surface-fg-muted flex flex-wrap items-center gap-0.5 px-4 py-2"
      >
        <button type="button" className={crumbClass} onClick={() => setStack([])}>
          {run.key}
        </button>
        {stack.map((id, i) => (
          <span key={`${id}-${i}`} className="flex items-center gap-0.5">
            <ChevronRightIcon aria-hidden="true" className="size-3.5" />
            <button
              type="button"
              className={crumbClass}
              onClick={() => setStack(stack.slice(0, i + 1))}
            >
              {id}
            </button>
          </span>
        ))}
      </nav>
      <div className="border-border grid min-h-0 flex-1 grid-cols-1 border-t lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="h-[60dvh] lg:h-auto">
          {def ? (
            <GraphCanvas
              def={def}
              catalog={catalog}
              status={status}
              selected={selected}
              onSelect={setSelected}
              onOpen={open}
            />
          ) : (
            <div className="p-6">
              <EmptyText reason="error">This graph is not available.</EmptyText>
            </div>
          )}
        </div>
        <aside className="border-border bg-surface overflow-y-auto border-t lg:border-t-0 lg:border-l">
          {node ? (
            <NodeExecutions
              title={catalog.titleOf(node)}
              steps={steps.filter((s) => s.path === path && s.node === node.id)}
              onOpen={catalog.opensAs(node) === 'graph' ? () => open(node.id) : undefined}
              runs={startedBy(node.id)}
            />
          ) : (
            <section aria-label="Run data" className="flex flex-col gap-5 p-4">
              <p className="text-surface-fg-muted text-sm">
                Select a node to inspect its values. Double-click a sub-graph or workflow node to
                open it.
              </p>
              <div className="flex flex-col gap-2">
                <h2 className={panelHeading}>Inputs</h2>
                <JsonView label="Run inputs" value={run.inputs} />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className={panelHeading}>Result</h2>
                <JsonView label="Run result" value={run.result ?? undefined} />
              </div>
              {children.length ? (
                <div className="flex flex-col gap-2">
                  <h2 className={panelHeading}>
                    Child runs
                    {childCount > children.length
                      ? ` (first ${children.length} of ${childCount})`
                      : ''}
                  </h2>
                  <ul className="divide-border border-border flex flex-col divide-y rounded-lg border text-sm">
                    {children.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <TextLink to={`/runs/${c.id}`}>
                          #{c.parent_index} {c.name}
                        </TextLink>
                        <RunStatusBadge status={c.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          )}
        </aside>
      </div>
      {active ? (
        <ConfirmDialog
          open={confirming}
          title="Cancel this run?"
          intent="danger"
          confirmLabel="Cancel run"
          confirmIcon={CircleStopIcon}
          dismissLabel="Keep running"
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onCancel().catch((err: unknown) => setError(messageOf(err)));
          }}
        >
          The run stops at its current step and will not continue.
        </ConfirmDialog>
      ) : null}
    </section>
  );
};

export const RunPage = ({ client, live, runId }: RunPageProps) => {
  const [active, setActive] = useState(true);
  const detail = useResource(`run:${runId}`, () => client.find(runId), active ? 15_000 : 0);
  const steps = useResource(`run-steps:${runId}`, () => client.steps(runId), active ? 15_000 : 0);
  const taskIds = new Set(detail.data?.tasks.map((t) => t.id));
  useLive(
    live,
    (e) =>
      e.kind === 'run'
        ? e.id === runId || e.parentId === runId
        : e.kind === 'task' && (e.runId === runId || (e.id !== null && taskIds.has(e.id))),
    () => {
      detail.reload();
      steps.reload();
    }
  );
  const graphs = useResource(`run-graphs:${runId}`, () => client.graphs(runId));
  const status = detail.data?.run.status;
  const { reload } = detail;

  useEffect(() => {
    if (status) setActive(!isFinished(status));
  }, [status]);

  const failure = detail.error ?? graphs.error ?? steps.error;
  if (failure) return <PageFailure message={failure.message} />;
  if (!detail.data || !graphs.data) return <PageLoading />;
  return (
    <RunView
      key={runId}
      detail={detail.data}
      graphs={graphs.data}
      steps={steps.data ?? []}
      onCancel={async () => {
        await client.cancel(runId);
        setActive(true);
        reload();
      }}
    />
  );
};
