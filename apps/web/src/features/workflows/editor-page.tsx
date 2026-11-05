import { type GraphDef, type Issue, isPassThrough, type NodeDef, tableRefOf } from '@ugula/graph';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError, messageOf } from '../../shared/api.ts';
import { type Catalog, createCatalog, type PaletteEntry } from '../../shared/graph/catalog.ts';
import {
  addNode,
  arranged,
  type NodeChange,
  placed,
  removeNodes
} from '../../shared/graph/flow.ts';
import { GraphCanvas } from '../../shared/graph/graph-canvas.tsx';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate, useLocation } from '../../shared/router.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Breadcrumbs } from '../../shared/ui/breadcrumbs.tsx';
import { Drawer } from '../../shared/ui/drawer.tsx';
import { PageFailure, PageLoading, WorkspaceHeader } from '../../shared/ui/page.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { hrefWith } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type {
  EditScope,
  EffectiveTable,
  GraphComparison,
  GraphDetail,
  WorkflowsClient
} from './client.ts';
import { ComparePanel } from './compare-panel.tsx';
import { type Busy, EditorActions } from './editor-actions.tsx';
import { type EditorDialog, EditorDialogs } from './editor-dialogs.tsx';
import { documentationHints, EditorNotices } from './editor-notices.tsx';
import { GraphSettings } from './graph-settings.tsx';
import { NodeInspector } from './node-inspector.tsx';
import { NodePicker } from './node-picker.tsx';
import { diffGraphs } from './override-diff.ts';
import { CopyBadge, RoleBadge, ScopeBadge, StaleBadge, scopeLabel } from './scope-badges.tsx';
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
  comparison: GraphComparison | null;
  tables: readonly EffectiveTable[];
  onRebased: () => void;
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
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<EditorDialog | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const location = useLocation();
  const panel = location.query.get('panel');
  const isSettingsOpen = panel === 'settings';
  const isCompareOpen = panel === 'compare';
  const showRemoved = location.query.get('removed') === 'shown';
  const panelHref = (name: 'settings' | 'compare' | null) =>
    hrefWith(location.path, location.query, { panel: name });
  const settingsHref = (open: boolean) => panelHref(open ? 'settings' : null);
  const select = (id: string | null) => {
    setSelected(id);
    if (id && panel) navigate(panelHref(null), { replace: true });
  };
  const [busy, setBusy] = useState<Busy | null>(null);
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
    setDef(next);
    setDirty(true);
  };

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

  const override = (scope: EditScope) =>
    run('override', async () => {
      const { id } = await client.override(graph.id, scope);
      notify({
        title: `${graph.name} copied for ${scope === 'agency' ? 'this agency' : 'your organization'}`,
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
      navigate(graph.overrides ? `/workflows/${graph.overrides}` : '/workflows');
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
      navigate(`/workflows/${graph.id}`);
      onRebased();
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
  const hints = editable ? documentationHints(def, catalog) : [];
  const isEmptySlot = graph.role === 'slot' && isPassThrough(def);
  const howTo = editable
    ? 'Select a node to see what it does and set it up. Drag from one pin to another to connect them.'
    : graph.scope === 'system'
      ? graph.effectiveScope !== 'system'
        ? `Your ${scopeLabel(graph.effectiveScope).toLowerCase()} has its own copy of this built-in ${noun}; runs use it once it is published. Select a node to see what it does.`
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
            <ScopeBadge scope={graph.scope} />
            <RoleBadge role={graph.role} />
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
            settingsHref={settingsHref(!isSettingsOpen)}
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
            onAdd={() => setDialog('add')}
            onArrange={() => change(arranged(def, catalog))}
            onVersion={(v) => leave(graphPath(graph.id, v, trail))}
            onOverride={override}
            onRemove={() => setDialog('remove')}
            onSave={save}
            onPublish={publish}
          />
        }
      />
      <p className="border-border bg-surface text-surface-fg-muted border-b px-4 py-2 text-xs">
        {howTo}
      </p>
      <EditorNotices
        error={error}
        issues={graphIssues}
        hints={hints}
        base={baseUpdated ? (graph.is_stale ? 'stale' : 'updated') : null}
        compareHref={panelHref('compare')}
        emptySlot={isEmptySlot ? (graph.scope === 'system' ? 'system' : 'copy') : null}
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
            {...(editable ? { onChange: change } : {})}
          />
        </div>
        {isSettingsOpen ? (
          <Drawer width="lg">
            <GraphSettings
              key={version}
              kind={graph.kind}
              def={def}
              editable={editable}
              onChange={change}
              onClose={() => navigate(settingsHref(false))}
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
              onOpen={catalog.publishedOf(node) ? () => openNode(node.id) : undefined}
              onClose={() => setSelected(null)}
              base={baseNode}
              table={nodeTable}
            />
          </Drawer>
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
      <EditorDialogs
        graph={graph}
        dialog={dialog}
        removable={removable}
        leaving={leaving}
        onClose={() => setDialog(null)}
        onRemove={() => void removeOverride()}
        onReset={() => void rebase('reset')}
        onStay={() => setLeaving(null)}
        onLeave={navigate}
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
  const catalog = useMemo(
    () => createCatalog(nodes, { published: published.data ?? [] }),
    [nodes, published.data]
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
