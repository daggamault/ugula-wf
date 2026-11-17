import { type GraphDef, type Issue, type NodeDef, type NodeRef, tableRefOf } from '@ugula/graph';
import { Redo2Icon, Undo2Icon, XIcon } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError, messageOf } from '../../shared/api.ts';
import { createEditTracker } from '../../shared/edit-tracker.ts';
import { type Catalog, createCatalog, type PaletteEntry } from '../../shared/graph/catalog.ts';
import {
  addNode,
  addWired,
  arranged,
  compatibleEntries,
  type NodeChange,
  type PinRef,
  placed,
  removeNodes
} from '../../shared/graph/flow.ts';
import {
  type AddRequest,
  type CanvasView,
  GraphCanvas,
  isTyping
} from '../../shared/graph/graph-canvas.tsx';
import { emptyHistory, recorded, redone, undone } from '../../shared/graph/history.ts';
import { pinLabel, WorkflowEventsContext } from '../../shared/graph/pins.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate, useLocation, useUnsavedChanges } from '../../shared/router.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Breadcrumbs } from '../../shared/ui/breadcrumbs.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Drawer } from '../../shared/ui/drawer.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { PageFailure, PageLoading, WorkspaceHeader } from '../../shared/ui/page.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { hrefWith } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { EffectiveTable, GraphComparison, GraphDetail, WorkflowsClient } from './client.ts';
import { ComparePanel } from './compare-panel.tsx';
import { type Busy, EditorActions } from './editor-actions.tsx';
import { type EditorDialog, EditorDialogs } from './editor-dialogs.tsx';
import { documentationHints, EditorNotices } from './editor-notices.tsx';
import { NodeInspector } from './node-inspector.tsx';
import { NodePicker } from './node-picker.tsx';
import { diffGraphs } from './override-diff.ts';
import { CopyBadge, ScopeBadge, StaleBadge, scopeLabel } from './scope-badges.tsx';
import { graphPath, type TrailStep, VERSION_PARAMS } from './trail.ts';
import { kindLabel, WorkflowDetailsDialog } from './workflow-details.tsx';
import { type VariableNode, WorkflowPanel } from './workflow-panel.tsx';

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
  comparison: GraphComparison | null;
  tables: readonly EffectiveTable[];
  onRebased: () => void;
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

export const customizedNodes = (
  def: GraphDef,
  catalog: Catalog,
  tables: ReadonlyMap<string, EffectiveTable>
) => {
  const out: Record<string, NodeChange> = {};
  for (const n of def.nodes) {
    const table = tables.get(tableRefOf(n)?.key ?? '');
    if (catalog.publishedOf(n)?.overridden || (table && table.scope !== 'system')) {
      out[n.id] = 'overridden';
    }
  }
  return out;
};

type Picker = { request: AddRequest; entries: readonly PaletteEntry[]; hint?: string };

export const pinHint = (def: GraphDef, catalog: Catalog, from: PinRef) => {
  const inst = def.nodes.find((n) => n.id === from.node);
  if (!inst) return 'Nodes that connect to this pin.';
  const sig = catalog.signatureOf(inst, def);
  const spec = [...(sig?.inputs ?? []), ...(sig?.outputs ?? [])].find((p) => p.name === from.pin);
  const pin = spec ? pinLabel(spec) : (catalog.exitsOf(inst, def)[from.pin]?.label ?? 'the flow');
  return `Nodes that connect to ${pin} on ${catalog.titleOf(inst)}.`;
};

const VARIABLE_NODES: Readonly<Record<VariableNode, NodeRef>> = {
  get: { type: 'std.var.get', version: 1 },
  set: { type: 'std.var.set', version: 1 }
};

export const lockedReason = (
  graph: Pick<GraphDetail['graph'], 'scope' | 'overrides'>,
  editable: boolean,
  noun: string
) =>
  graph.overrides
    ? `A copy keeps the inputs and outputs of the built-in ${noun} it overrides, so everything that uses it keeps working.`
    : graph.scope === 'system'
      ? `Built-in ${noun}s are read-only. This is what it takes in, hands back and keeps while it runs.`
      : editable
        ? null
        : `Published versions are read-only. Open a draft to change what this ${noun} takes and returns.`;

export const EditorView = ({
  detail,
  version,
  source,
  catalog,
  client,
  trail,
  nameOf,
  onSaved,
  comparison,
  tables,
  onRebased
}: EditorViewProps) => {
  const { graph, versions } = detail;
  const current = versions.find((v) => v.version === version);
  const draft = versions.find((v) => !v.published_at);
  const isDraft = current !== undefined && !current.published_at;
  const editable = graph.canEdit && isDraft;
  const removable = graph.canEdit && graph.scope !== 'system';
  const [def, setDef] = useState(() => (editable ? placed(source, catalog) : source));
  const [dirty, setDirty] = useState(false);
  const [edits] = useState(createEditTracker);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<EditorDialog | null>(null);
  const [isEditingDetails, setEditingDetails] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [history, setHistory] = useState(emptyHistory);
  const view = useRef<CanvasView>(null);
  const location = useLocation();
  const panel = location.query.get('panel');
  const isCustom = graph.scope === 'agency' && !graph.overrides;
  const isSignatureOpen = panel === 'signature';
  const inside = location.query.get('inside');
  const isCompareOpen = panel === 'compare';
  const showRemoved = location.query.get('removed') === 'shown';
  const panelHref = (name: 'signature' | 'compare' | null) =>
    hrefWith(location.path, location.query, { panel: name });
  const insideHref = (id: string | null) => hrefWith(location.path, location.query, { inside: id });
  const select = (id: string | null) => {
    setSelected(id);
    if (id && panel) navigate(panelHref(null), { replace: true });
  };
  const [busy, setBusy] = useState<Busy | null>(null);
  useUnsavedChanges(dirty, VERSION_PARAMS);
  const [error, setError] = useState('');
  const notify = useToast();
  const openNode = (id: string) => {
    const inst = def.nodes.find((n) => n.id === id);
    const target = inst ? catalog.publishedOf(inst) : undefined;
    if (target) {
      navigate(
        graphPath(target.graph_id, target.version, [...trail, { graphId: graph.id, version }])
      );
    } else if (inst && catalog.graphOf(inst)) {
      navigate(insideHref(id));
    }
  };
  const insideNode = def.nodes.find((n) => n.id === inside);
  const insideGraph = insideNode ? catalog.graphOf(insideNode) : undefined;
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
  const baseDef = graph.scope === 'system' ? undefined : comparison?.copiedFrom?.definition;
  const diff = useMemo(() => (baseDef ? diffGraphs(baseDef, def) : null), [baseDef, def]);
  const tableByKey = useMemo(() => new Map(tables.map((t) => [t.key, t])), [tables]);
  const changes = useMemo(
    () => ({ ...customizedNodes(def, catalog, tableByKey), ...diff?.changes }),
    [def, catalog, tableByKey, diff]
  );
  const baseNode = node && baseDef?.nodes.find((n) => n.id === node.id);
  const nodeTable = node && tableByKey.get(tableRefOf(node)?.key ?? '');
  const baseUpdated =
    graph.scope !== 'system' && (graph.is_stale || comparison?.baseChanged === true);

  const change = (next: GraphDef) => {
    edits.edit();
    setHistory((h) => recorded(h, def, Date.now()));
    setDef(next);
    setDirty(true);
  };

  const travel = (step: typeof undone) => {
    const moved = step(history, def);
    if (!moved) return;
    edits.edit();
    setHistory(moved.history);
    setDef(moved.def);
    setDirty(true);
  };
  const undo = () => travel(undone);
  const redo = () => travel(redone);
  const keys = useRef({ undo, redo });
  keys.current = { undo, redo };

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) keys.current.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') keys.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable]);

  const run = async (kind: Busy, action: () => Promise<void>) => {
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
      const unchanged = edits.mark();
      const saved = await client.saveDraft(graph.id, def);
      setIssues(saved.issues);
      if (unchanged()) setDirty(false);
      notify(
        saved.issues.length
          ? {
              intent: 'warning',
              title: `Draft v${saved.version} saved with ${saved.issues.length} ${saved.issues.length === 1 ? 'problem' : 'problems'}`,
              description: 'Fix the highlighted nodes before publishing.'
            }
          : { title: `Draft v${saved.version} saved` }
      );
      if (saved.version !== version) {
        navigate(graphPath(graph.id, saved.version, trail), { force: true });
      }
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
        title: `${graph.name} copied for this agency`,
        description: `Change and publish the copy; new runs then use it everywhere this ${noun} is used.`
      });
      navigate(`/workflows/${id}`);
    });

  const removeOverride = () =>
    run('remove', async () => {
      await client.remove(graph.id);
      notify(
        graph.overrides
          ? {
              title: 'Override removed',
              description: `New runs use the ${graph.name} this copy overrode again.`
            }
          : { title: `${label} deleted`, description: `${graph.name} is gone.` }
      );
      navigate(graph.overrides ? `/workflows/${graph.overrides}` : '/workflows', { force: true });
    });

  const rebase = (mode: 'keep' | 'reset') =>
    run('rebase', async () => {
      await client.rebase(graph.id, mode);
      setDirty(false);
      notify(
        mode === 'keep'
          ? {
              title: 'Kept your changes',
              description: 'Your draft is now based on the newest base.'
            }
          : { title: 'Started from the base', description: 'Your draft is the newest base again.' }
      );
      navigate(`/workflows/${graph.id}`, { force: true });
      onRebased();
    });

  const openPicker = (request: AddRequest | null | undefined) => {
    if (!request) return;
    setPicker(
      request.from
        ? {
            request,
            entries: compatibleEntries(def, catalog, request.from),
            hint: pinHint(def, catalog, request.from)
          }
        : { request, entries: catalog.palette }
    );
  };

  const addVariableNode = (name: string, node: VariableNode) => {
    const at = view.current?.centre()?.at ?? { x: 0, y: 0 };
    const added = addNode(def, VARIABLE_NODES[node], at, { name });
    change(added.def);
    select(added.id);
  };

  const add = (entry: PaletteEntry) => {
    if (!picker) return;
    const added = addWired(def, catalog, entry, picker.request.at, picker.request.from);
    change(added.def);
    setSelected(added.id);
    setPicker(null);
    notify({
      key: 'node-added',
      title: `${entry.title} added`,
      description: `Drag from its pins to connect it to the rest of the ${noun}.`
    });
  };
  const graphIssues = issues.filter((i) => !i.node);
  const hints = editable ? documentationHints(def, catalog) : [];
  const howTo = editable
    ? 'Select a node to see what it does and set it up. Drag from one pin to another to connect them, or drop a wire on empty space to add a node that fits; right-click or press A to add any node. Alt+click a wire or pin to disconnect it.'
    : graph.scope === 'system'
      ? graph.effectiveScope !== 'system'
        ? `Your ${scopeLabel(graph.effectiveScope).toLowerCase()} has its own copy of this built-in ${noun}; runs use it once it is published. Select a node to see what it does.`
        : `Built-in ${noun}s are read-only. Customize this one to change how your agency runs it.`
      : draft
        ? `Published versions are read-only. Open draft v${draft.version} to make changes.`
        : 'Published versions are read-only. Edit as a new draft to make changes.';

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {isEditingDetails ? (
        <WorkflowDetailsDialog
          mode="edit"
          kind={graph.kind}
          initial={{ name: graph.name, description: graph.description }}
          onClose={() => setEditingDetails(false)}
          onSubmit={async (details) => {
            await client.updateDetails(graph.id, details);
            setEditingDetails(false);
            notify({ title: 'Details saved', description: `${details.name} is saved.` });
            onSaved();
          }}
        />
      ) : null}
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
            <ScopeBadge scope={graph.scope} />
            <CopyBadge scope={graph.scope} effective={graph.effectiveScope} />
            <StaleBadge stale={baseUpdated} />
            {dirty ? <Badge intent="danger">Unsaved</Badge> : null}
          </span>
        }
        actions={
          <EditorActions
            detail={detail}
            version={version}
            editable={editable}
            removable={removable}
            dirty={dirty}
            busy={busy}
            signatureHref={panelHref(isSignatureOpen ? null : 'signature')}
            compareHref={
              comparison?.copiedFrom && graph.scope !== 'system'
                ? panelHref(isCompareOpen ? null : 'compare')
                : null
            }
            removed={
              diff?.removed.length
                ? {
                    href: hrefWith(location.path, location.query, {
                      removed: showRemoved ? null : 'shown'
                    }),
                    shown: showRemoved
                  }
                : null
            }
            onAdd={() => openPicker(view.current?.centre())}
            onArrange={() => change(arranged(def, catalog))}
            onVersion={(v) => navigate(graphPath(graph.id, v, trail))}
            onOverride={override}
            onDetails={graph.canEdit && isCustom ? () => setEditingDetails(true) : null}
            onRemove={() => setDialog('remove')}
            onSave={save}
            onPublish={publish}
          />
        }
      />
      <p className="border-border bg-surface text-surface-fg-muted border-b px-4 py-2 text-xs">
        {howTo}
      </p>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorNotices
            error={error}
            issues={graphIssues}
            hints={hints}
            base={baseUpdated ? (graph.is_stale ? 'stale' : 'updated') : null}
            compareHref={panelHref('compare')}
          />
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <GraphCanvas
                def={def}
                catalog={catalog}
                issues={issuesByNode(issues)}
                changes={changes}
                {...(diff ? { changedEdges: diff.changedEdges } : {})}
                {...(diff && showRemoved ? { removed: diff.removed } : {})}
                selected={selected}
                onSelect={select}
                onOpen={openNode}
                viewRef={view}
                {...(editable
                  ? {
                      onChange: change,
                      onAdd: openPicker,
                      tools: (
                        <>
                          <Button
                            variant="outline"
                            disabledReason={history.past.length ? undefined : 'Nothing to undo.'}
                            onClick={undo}
                          >
                            <Undo2Icon aria-hidden="true" className="size-4" />
                            Undo
                          </Button>
                          <Button
                            variant="outline"
                            disabledReason={history.future.length ? undefined : 'Nothing to redo.'}
                            onClick={redo}
                          >
                            <Redo2Icon aria-hidden="true" className="size-4" />
                            Redo
                          </Button>
                        </>
                      )
                    }
                  : {})}
              />
            </div>
            {insideNode && insideGraph ? (
              <section
                aria-labelledby="inside-title"
                className="bg-canvas absolute inset-0 z-10 flex flex-col"
              >
                <header className="border-border bg-surface flex items-center justify-between gap-4 border-b px-4 py-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 id="inside-title" className="truncate text-base font-bold">
                      Inside {catalog.titleOf(insideNode)}
                    </h2>
                    <p className="text-surface-fg-muted text-xs">
                      A built-in subworkflow, shown read-only.
                    </p>
                  </div>
                  <IconButton
                    label={`Close ${catalog.titleOf(insideNode)}`}
                    tooltip="Close"
                    icon={XIcon}
                    tooltipSide="left"
                    onClick={() => navigate(insideHref(null))}
                  />
                </header>
                <div className="relative min-h-0 flex-1">
                  <div className="absolute inset-0">
                    <GraphCanvas
                      def={insideGraph}
                      catalog={catalog}
                      selected={null}
                      onSelect={() => undefined}
                    />
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
        {isSignatureOpen ? (
          <Drawer width="lg">
            <WorkflowPanel
              key={version}
              kind={graph.kind}
              def={def}
              editable={editable && isCustom}
              locked={lockedReason(graph, editable, noun)}
              onChange={change}
              onVariableNode={editable && isCustom ? addVariableNode : undefined}
              onClose={() => navigate(panelHref(null))}
            />
          </Drawer>
        ) : isCompareOpen && comparison ? (
          <Drawer width="lg">
            <ComparePanel
              comparison={comparison}
              current={def}
              noun={noun}
              titleOf={catalog.titleOf}
              canEdit={graph.canEdit}
              busy={busy === 'rebase'}
              onKeep={() => void rebase('keep')}
              onReset={() => setDialog('reset')}
              onClose={() => navigate(panelHref(null))}
            />
          </Drawer>
        ) : node ? (
          <Drawer width="md">
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
              onOpen={catalog.opensAs(node) ? () => openNode(node.id) : undefined}
              onClose={() => setSelected(null)}
              base={baseNode}
              table={nodeTable}
              isWorkflow={graph.kind === 'workflow'}
            />
          </Drawer>
        ) : null}
      </div>
      {editable && picker ? (
        <NodePicker
          entries={picker.entries}
          at={picker.request.screen}
          hint={picker.hint}
          onAdd={add}
          onClose={() => setPicker(null)}
        />
      ) : null}
      <EditorDialogs
        graph={graph}
        dialog={dialog}
        removable={removable}
        onClose={() => setDialog(null)}
        onRemove={() => void removeOverride()}
        onReset={() => void rebase('reset')}
      />
    </section>
  );
};

export const EditorPage = ({ client, live, nodes, graphId, version, trail }: EditorPageProps) => {
  const detail = useResource(`graph:${graphId}`, (signal) => client.find(graphId, signal));
  const published = useResource('graph-nodes', client.nodes);
  const comparison = useResource(`graph:${graphId}:compare`, (signal) =>
    client.compare(graphId, signal)
  );
  const tables = useResource('tables:effective', client.tables.effective);
  useReconnect(live, () => {
    detail.reload();
    published.reload();
    comparison.reload();
    tables.reload();
  });
  const versions = detail.data?.versions ?? [];
  const chosen =
    version ?? versions.find((v) => !v.published_at)?.version ?? versions[0]?.version ?? null;
  const source = useResource(`graph:${graphId}:v${chosen}`, () =>
    chosen === null ? Promise.resolve(null) : client.version(graphId, chosen)
  );
  const events = useContext(WorkflowEventsContext);
  const catalog = useMemo(
    () => createCatalog(nodes, { published: published.data ?? [], events }),
    [nodes, published.data, events]
  );
  const { reload } = detail;
  const loads = useRef(0);
  const sourceLoad = useMemo(() => (source.data ? ++loads.current : 0), [source.data]);

  useEffect(() => {
    if (version === null && chosen !== null) {
      navigate(graphPath(graphId, chosen, trail), { replace: true });
    }
  }, [graphId, version, chosen, trail]);

  const failure = detail.error ?? source.error ?? published.error ?? tables.error;
  if (failure) return <PageFailure message={failure.message} />;
  if (!detail.data || !source.data || chosen === null || source.data.version !== chosen)
    return <PageLoading />;
  return (
    <EditorView
      key={`${graphId}:${chosen}:${sourceLoad}`}
      detail={detail.data}
      version={chosen}
      source={source.data.definition}
      catalog={catalog}
      client={client}
      trail={trail}
      nameOf={(id) => published.data?.find((p) => p.graph_id === id)?.name ?? 'Workflow'}
      onSaved={() => {
        reload();
        comparison.reload();
      }}
      comparison={comparison.data ?? null}
      tables={tables.data ?? []}
      onRebased={() => {
        reload();
        comparison.reload();
        source.reload();
      }}
    />
  );
};
