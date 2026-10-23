import type { GraphDef, Issue } from '@ugula/graph';
import { PencilIcon, PlayIcon, SaveIcon, UploadIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isApiError, messageOf } from '../../shared/api.ts';
import { type Catalog, createCatalog, type PaletteEntry } from '../../shared/graph/catalog.ts';
import { addNode, removeNodes } from '../../shared/graph/flow.ts';
import { GraphCanvas } from '../../shared/graph/graph-canvas.tsx';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Breadcrumbs } from '../../shared/ui/breadcrumbs.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { pendingActionMessage } from '../../shared/ui/disabled-reason.tsx';
import { PageFailure, PageLoading, WorkspaceHeader } from '../../shared/ui/page.tsx';
import { NativeSelect } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphDetail, WorkflowsClient } from './client.ts';
import { GraphPanel } from './graph-panel.tsx';
import { NodePanel } from './node-panel.tsx';
import { Palette } from './palette.tsx';
import { graphPath, type TrailStep } from './trail.ts';

export type EditorPageProps = {
  client: WorkflowsClient;
  graphId: string;
  version: number | null;
  trail: readonly TrailStep[];
};

export type EditorViewProps = {
  detail: GraphDetail;
  version: number;
  source: GraphDef;
  catalog: Catalog;
  client: WorkflowsClient;
  trail: readonly TrailStep[];
  nameOf: (graphId: string) => string;
  onSaved: () => void;
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
  const editable = graph.tenant_id !== null && isDraft;
  const [def, setDef] = useState(source);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [error, setError] = useState('');
  const notify = useToast();
  const openNode = (id: string) => {
    const inst = def.nodes.find((n) => n.id === id);
    const target = inst ? catalog.publishedOf(inst) : undefined;
    if (!target) return;
    if (dirty) setError('Save your changes before opening another workflow.');
    else
      navigate(
        graphPath(target.graph_id, target.version, [...trail, { graphId: graph.id, version }])
      );
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

  const change = (next: GraphDef) => {
    setDef(next);
    setDirty(true);
  };

  const run = async (kind: 'save' | 'publish', action: () => Promise<void>) => {
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

  const add = (entry: PaletteEntry) => {
    const placed = addNode(def, entry, {
      x: 120 + def.nodes.length * 24,
      y: 120 + def.nodes.length * 24
    });
    change(placed.def);
    setSelected(placed.id);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
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
            {graph.tenant_id === null ? <Badge>System</Badge> : null}
            {dirty ? <Badge intent="danger">Unsaved</Badge> : null}
          </span>
        }
        actions={
          <>
            <div className="w-36">
              <NativeSelect
                aria-label="Version"
                value={String(version)}
                options={versions.map((v) => ({
                  value: String(v.version),
                  label: `v${v.version}${v.published_at ? '' : ' (draft)'}`
                }))}
                onChange={(e) => navigate(graphPath(graph.id, Number(e.target.value), trail))}
              />
            </div>
            {graph.tenant_id !== null && !isDraft && !draft ? (
              <Button variant="outline" isPending={busy === 'save'} onClick={save}>
                <PencilIcon aria-hidden="true" className="size-4" />
                Edit as new draft
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
      {error ? (
        <div className="px-4 py-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <aside className="border-border bg-surface order-2 max-h-80 overflow-y-auto border-t lg:order-1 lg:max-h-none lg:border-t-0 lg:border-r">
          <Palette entries={catalog.palette} disabled={!editable} onAdd={add} />
        </aside>
        <div className="order-1 h-[60dvh] lg:order-2 lg:h-auto">
          <GraphCanvas
            def={def}
            catalog={catalog}
            issues={issuesByNode(issues)}
            selected={selected}
            onSelect={setSelected}
            onOpen={openNode}
            {...(editable ? { onChange: change } : {})}
          />
        </div>
        <aside className="border-border bg-surface order-3 overflow-y-auto border-t lg:border-t-0 lg:border-l">
          {node ? (
            <NodePanel
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
            />
          ) : (
            <GraphPanel
              key={version}
              def={def}
              issues={issues.filter((i) => !i.node)}
              editable={editable}
              onChange={change}
            />
          )}
        </aside>
      </div>
    </section>
  );
};

export const EditorPage = ({ client, graphId, version, trail }: EditorPageProps) => {
  const detail = useResource(`graph:${graphId}`, () => client.find(graphId));
  const published = useResource('graph-nodes', client.nodes);
  const versions = detail.data?.versions ?? [];
  const chosen =
    version ?? versions.find((v) => !v.published_at)?.version ?? versions[0]?.version ?? null;
  const source = useResource(`graph:${graphId}:v${chosen}`, () =>
    chosen === null ? Promise.resolve(null) : client.version(graphId, chosen)
  );
  const catalog = useMemo(
    () => createCatalog({ published: published.data ?? [] }),
    [published.data]
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
