import type { GraphDef, Issue, NodeDef } from '@ugula/graph';
import {
  CopyPlusIcon,
  NetworkIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UploadIcon
} from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { isApiError, messageOf } from '../../shared/api.ts';
import { type Catalog, createCatalog, type PaletteEntry } from '../../shared/graph/catalog.ts';
import { addNode, arranged, placed, removeNodes } from '../../shared/graph/flow.ts';
import { GraphCanvas } from '../../shared/graph/graph-canvas.tsx';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate, useLocation } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Breadcrumbs } from '../../shared/ui/breadcrumbs.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import { PageFailure, PageLoading, WorkspaceHeader } from '../../shared/ui/page.tsx';
import { NativeSelect } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { hrefWith } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphDetail, WorkflowsClient } from './client.ts';
import { GraphSettings } from './graph-settings.tsx';
import { NodeInspector } from './node-inspector.tsx';
import { NodePicker } from './node-picker.tsx';
import { graphPath, type TrailStep } from './trail.ts';
import { kindLabel } from './workflows-page.tsx';

type EditorPageProps = {
  client: WorkflowsClient;
  live: Live;
  nodes: NodeDef[];
  graphId: string;
  version: number | null;
  trail: readonly TrailStep[];
};

type EditorViewProps = {
  detail: GraphDetail;
  version: number;
  source: GraphDef;
  catalog: Catalog;
  client: WorkflowsClient;
  trail: readonly TrailStep[];
  nameOf: (graphId: string) => string;
  onSaved: () => void;
};

export const leavingHref = (
  target: Pick<Element, 'closest'>,
  path: string,
  e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey'>
) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return null;
  const href = target.closest('a[href]')?.getAttribute('href');
  return href && new URL(href, 'http://local').pathname !== path ? href : null;
};

const issuesByNode = (issues: readonly Issue[]) => {
  const map: Record<string, string[]> = {};
  for (const { node, message } of issues) {
    if (!node) continue;
    const list = map[node];
    if (list) list.push(message);
    else map[node] = [message];
  }
  return map;
};

export const EditorView = ({
  detail,
  version,
  source,
  catalog,
  client,
  trail,
  nameOf,
  onSaved
}: EditorViewProps) => {
  const { graph, versions } = detail;
  const current = versions.find((v) => v.version === version);
  const draft = versions.find((v) => !v.published_at);
  const isDraft = current !== undefined && !current.published_at;
  const editable = graph.canEdit && isDraft;
  const [def, setDef] = useState(() => (editable ? placed(source, catalog) : source));
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'add' | 'remove' | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const location = useLocation();
  const isSettingsOpen = location.query.get('panel') === 'settings';
  const settingsHref = (open: boolean) =>
    hrefWith(location.path, location.query, { panel: open ? 'settings' : null });
  const select = (id: string | null) => {
    setSelected(id);
    if (id && isSettingsOpen) navigate(settingsHref(false), { replace: true });
  };
  const [busy, setBusy] = useState<'save' | 'publish' | 'override' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const notify = useToast();
  const leave = (to: string) => (dirty ? setLeaving(to) : navigate(to));
  const guardLinks = (e: MouseEvent) => {
    const to = dirty ? leavingHref(e.target as Element, location.path, e) : null;
    if (!to) return;
    e.preventDefault();
    setLeaving(to);
  };
  const openNode = (id: string) => {
    const inst = def.nodes.find((n) => n.id === id);
    const target = inst ? catalog.publishedOf(inst) : undefined;
    if (target) {
      leave(graphPath(target.graph_id, target.version, [...trail, { graphId: graph.id, version }]));
    }
  };
  const parent = trail.at(-1);
  const crumbs = [
    { label: 'Workflows', to: '/workflows' },
    ...trail.map((s, i) => ({
      label: nameOf(s.graphId),
      to: graphPath(s.graphId, s.version, trail.slice(0, i))
    })),
    { label: graph.name }
  ];
  const node = def.nodes.find((n) => n.id === selected);
  const label = kindLabel(graph.kind);
  const noun = label.toLowerCase();

  const change = (next: GraphDef) => {
    setDef(next);
    setDirty(true);
  };

  const run = async (
    kind: 'save' | 'publish' | 'override' | 'remove',
    action: () => Promise<void>
  ) => {
    setBusy(kind);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
      if (isApiError(err) && Array.isArray(err.body.issues)) setIssues(err.body.issues as Issue[]);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const saved = await client.saveDraft(graph.id, def);
      setIssues(saved.issues);
      setDirty(false);
      notify(
        saved.issues.length
          ? {
              intent: 'warning',
              title: `Draft v${saved.version} saved with ${saved.issues.length} ${saved.issues.length === 1 ? 'problem' : 'problems'}`,
              description: 'Fix the highlighted nodes before publishing.'
            }
          : { title: `Draft v${saved.version} saved` }
      );
      if (saved.version !== version) navigate(graphPath(graph.id, saved.version, trail));
      onSaved();
    });

  const publish = () =>
    run('publish', async () => {
      await client.publish(graph.id);
      setIssues([]);
      notify({
        title: `${graph.name} v${version} published`,
        description: 'New runs use this version from now on.'
      });
      onSaved();
    });

  const override = () =>
    run('override', async () => {
      const { id } = await client.override(graph.id);
      notify({
        title: `${graph.name} copied for your agency`,
        description: `Change and publish the copy; new runs then use it everywhere this ${noun} is used.`
      });
      navigate(`/workflows/${id}`);
    });

  const removeOverride = () =>
    run('remove', async () => {
      await client.remove(graph.id);
      notify({
        title: 'Override removed',
        description: `New runs use the built-in ${graph.name} again.`
      });
      navigate(graph.overrides ? `/workflows/${graph.overrides}` : '/workflows');
    });

  const add = (entry: PaletteEntry) => {
    const added = addNode(def, entry, {
      x: 120 + def.nodes.length * 24,
      y: 120 + def.nodes.length * 24
    });
    change(added.def);
    setSelected(added.id);
    setDialog(null);
    notify({
      key: 'node-added',
      title: `${entry.title} added`,
      description: `Drag from its pins to connect it to the rest of the ${noun}.`
    });
  };
  const graphIssues = issues.filter((i) => !i.node);
  const howTo = editable
    ? 'Select a node to see what it does and set it up. Drag from one pin to another to connect them.'
    : graph.scope === 'system'
      ? graph.overridden_by
        ? `Your agency has its own copy of this built-in ${noun}; runs use it once it is published. Select a node to see what it does.`
        : `Built-in ${noun}s are read-only. Override this one to change how your agency runs it.`
      : draft
        ? `Published versions are read-only. Open draft v${draft.version} to make changes.`
        : 'Published versions are read-only. Edit as a new draft to make changes.';

  return (
    <section className="flex min-h-0 flex-1 flex-col" onClickCapture={guardLinks}>
      <WorkspaceHeader
        backTo={
          parent ? graphPath(parent.graphId, parent.version, trail.slice(0, -1)) : '/workflows'
        }
        backLabel={parent ? `Back to ${nameOf(parent.graphId)}` : 'Back to Workflows'}
        breadcrumbs={trail.length ? <Breadcrumbs label="Workflow path" crumbs={crumbs} /> : null}
        title={graph.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <code className="font-mono">{graph.key}</code>
            <Badge intent={isDraft ? 'warning' : 'success'}>
              {isDraft ? `Draft v${version}` : `Published v${version}`}
            </Badge>
            {graph.scope === 'system' ? <Badge>System</Badge> : null}
            {graph.overridden_by ? <Badge intent="info">Has Your Copy</Badge> : null}
            {graph.overrides ? <Badge intent="info">Your Copy</Badge> : null}
            {dirty ? <Badge intent="danger">Unsaved</Badge> : null}
          </span>
        }
        actions={
          <>
            {editable ? (
              <Button onClick={() => setDialog('add')}>
                <PlusIcon aria-hidden="true" className="size-4" />
                Add Node
              </Button>
            ) : null}
            {editable ? (
              <Button variant="outline" onClick={() => change(arranged(def, catalog))}>
                <NetworkIcon aria-hidden="true" className="size-4" />
                Arrange Nodes
              </Button>
            ) : null}
            <ButtonLink to={settingsHref(!isSettingsOpen)} variant="outline">
              <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
              {label} Settings
            </ButtonLink>
            <div className="w-36">
              <NativeSelect
                aria-label="Version"
                value={String(version)}
                options={versions.map((v) => ({
                  value: String(v.version),
                  label: `v${v.version}${v.published_at ? '' : ' (Draft)'}`
                }))}
                onChange={(e) => leave(graphPath(graph.id, Number(e.target.value), trail))}
              />
            </div>
            {graph.scope === 'system' && graph.overridden_by ? (
              <ButtonLink to={`/workflows/${graph.overridden_by}`} variant="outline">
                <PencilIcon aria-hidden="true" className="size-4" />
                Edit Override
              </ButtonLink>
            ) : null}
            {graph.scope === 'system' && !graph.overridden_by ? (
              <Button variant="outline" isPending={busy === 'override'} onClick={override}>
                <CopyPlusIcon aria-hidden="true" className="size-4" />
                Override
              </Button>
            ) : null}
            {graph.overrides ? (
              <Button
                variant="outline"
                intent="danger"
                isPending={busy === 'remove'}
                onClick={() => setDialog('remove')}
              >
                <Trash2Icon aria-hidden="true" className="size-4" />
                Remove Override
              </Button>
            ) : null}
            {graph.canEdit && !isDraft && !draft ? (
              <Button variant="outline" isPending={busy === 'save'} onClick={save}>
                <PencilIcon aria-hidden="true" className="size-4" />
                Edit as New Draft
              </Button>
            ) : null}
            {editable ? (
              <>
                <Button
                  variant="outline"
                  isPending={busy === 'save'}
                  disabledReason={
                    busy === 'publish'
                      ? pendingActionMessage
                      : dirty
                        ? undefined
                        : 'No changes to save.'
                  }
                  onClick={save}
                >
                  <SaveIcon aria-hidden="true" className="size-4" />
                  Save
                </Button>
                <Button
                  isPending={busy === 'publish'}
                  disabledReason={
                    busy === 'save'
                      ? pendingActionMessage
                      : dirty
                        ? 'Save your changes first.'
                        : undefined
                  }
                  onClick={publish}
                >
                  <UploadIcon aria-hidden="true" className="size-4" />
                  Publish
                </Button>
              </>
            ) : null}
            {graph.kind === 'workflow' && versions.some((v) => v.published_at) ? (
              <ButtonLink to={`/runs/new?graph=${graph.id}`} variant="outline">
                <PlayIcon aria-hidden="true" className="size-4" />
                Run
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <p className="border-border bg-surface text-surface-fg-muted border-b px-4 py-2 text-xs">
        {howTo}
      </p>
      {error || graphIssues.length ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          {error ? <Alert>{error}</Alert> : null}
          {graphIssues.map((issue, i) => (
            <Alert key={`${i}-${issue.message}`} intent="warning">
              {issue.message}
            </Alert>
          ))}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <GraphCanvas
            def={def}
            catalog={catalog}
            issues={issuesByNode(issues)}
            selected={selected}
            onSelect={select}
            onOpen={openNode}
            {...(editable ? { onChange: change } : {})}
          />
        </div>
        {isSettingsOpen ? (
          <div className="border-border bg-surface absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l shadow-lg transition-[opacity,translate] duration-200 ease-out sm:w-[32rem] starting:translate-x-4 starting:opacity-0">
            <GraphSettings
              key={version}
              kind={graph.kind}
              def={def}
              editable={editable}
              onChange={change}
              onClose={() => navigate(settingsHref(false))}
            />
          </div>
        ) : node ? (
          <div className="border-border bg-surface absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l shadow-lg transition-[opacity,translate] duration-200 ease-out sm:w-96 starting:translate-x-4 starting:opacity-0">
            <NodeInspector
              key={node.id}
              def={def}
              node={node}
              catalog={catalog}
              editable={editable}
              onChange={change}
              onDelete={() => {
                change(removeNodes(def, [node.id]));
                setSelected(null);
              }}
              onOpen={catalog.publishedOf(node) ? () => openNode(node.id) : undefined}
              onClose={() => setSelected(null)}
            />
          </div>
        ) : null}
      </div>
      {editable ? (
        <NodePicker
          open={dialog === 'add'}
          entries={catalog.palette}
          onAdd={add}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === 'remove'}
        title="Remove Override?"
        intent="danger"
        confirmLabel="Remove Override"
        confirmIcon={Trash2Icon}
        dismissLabel="Keep"
        onClose={() => setDialog(null)}
        onConfirm={() => {
          setDialog(null);
          void removeOverride();
        }}
      >
        Are you sure? New runs go back to the built-in {graph.name}. Runs that already started keep
        using your copy. Override it again later to bring your copy back.
      </ConfirmDialog>
      <ConfirmDialog
        open={leaving !== null}
        title="Discard Unsaved Changes?"
        intent="danger"
        confirmLabel="Discard Changes"
        confirmIcon={Trash2Icon}
        dismissLabel="Keep Editing"
        onClose={() => setLeaving(null)}
        onConfirm={() => {
          const to = leaving;
          setLeaving(null);
          if (to) navigate(to);
        }}
      >
        Your changes to {graph.name} have not been saved. Leave anyway and lose them?
      </ConfirmDialog>
    </section>
  );
};

export const EditorPage = ({ client, live, nodes, graphId, version, trail }: EditorPageProps) => {
  const detail = useResource(`graph:${graphId}`, (signal) => client.find(graphId, signal));
  const published = useResource('graph-nodes', client.nodes);
  useReconnect(live, () => {
    detail.reload();
    published.reload();
  });
  const versions = detail.data?.versions ?? [];
  const chosen =
    version ?? versions.find((v) => !v.published_at)?.version ?? versions[0]?.version ?? null;
  const source = useResource(`graph:${graphId}:v${chosen}`, () =>
    chosen === null ? Promise.resolve(null) : client.version(graphId, chosen)
  );
  const catalog = useMemo(
    () => createCatalog(nodes, { published: published.data ?? [] }),
    [nodes, published.data]
  );
  const { reload } = detail;

  useEffect(() => {
    if (version === null && chosen !== null) {
      navigate(graphPath(graphId, chosen, trail), { replace: true });
    }
  }, [graphId, version, chosen, trail]);

  const failure = detail.error ?? source.error ?? published.error;
  if (failure) return <PageFailure message={failure.message} />;
  if (!detail.data || !source.data || chosen === null || source.data.version !== chosen)
    return <PageLoading />;
  return (
    <EditorView
      key={`${graphId}:${chosen}`}
      detail={detail.data}
      version={chosen}
      source={source.data.definition}
      catalog={catalog}
      client={client}
      trail={trail}
      nameOf={(id) => published.data?.find((p) => p.graph_id === id)?.name ?? 'Workflow'}
      onSaved={reload}
    />
  );
};
