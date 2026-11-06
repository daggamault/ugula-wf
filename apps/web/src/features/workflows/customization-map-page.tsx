import { EyeIcon, EyeOffIcon, TableIcon } from 'lucide-react';
import { classNamesOf } from '../../shared/class-names.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type {
  CustomizationMap,
  EffectiveTable,
  GraphRole,
  GraphScope,
  WorkflowsClient
} from './client.ts';
import { RoleBadge, ScopeBadge } from './scope-badges.tsx';
import { CUSTOMIZED_PATH } from './workflows-page.tsx';

export type MapNode = {
  key: string;
  id: string;
  name: string;
  role: GraphRole;
  scope: GraphScope;
  customized: boolean;
  tables: EffectiveTable[];
  children: MapNode[];
};

const isCustom = (scope: GraphScope) => scope !== 'system';

const hasCustomized = (n: MapNode): boolean =>
  n.customized || n.tables.some((t) => isCustom(t.scope)) || n.children.some(hasCustomized);

const prune = (n: MapNode): MapNode => ({
  ...n,
  tables: n.tables.filter((t) => isCustom(t.scope)),
  children: n.children.filter(hasCustomized).map(prune)
});

export const buildMap = (map: CustomizationMap, onlyCustomized: boolean): MapNode[] => {
  const byKey = new Map(map.graphs.map((g) => [g.key, g]));
  const tables = new Map(map.tables.map((t) => [t.key, t]));
  const grow = (key: string, path: ReadonlySet<string>): MapNode[] => {
    const g = byKey.get(key);
    if (!g || path.has(key)) return [];
    const next = new Set([...path, key]);
    return [
      {
        key: g.key,
        id: g.id,
        name: g.name,
        role: g.role,
        scope: g.scope,
        customized: isCustom(g.scope),
        tables: g.tables.flatMap((t) => tables.get(t) ?? []),
        children: g.children.flatMap((c) => grow(c, next))
      }
    ];
  };
  const roots = map.graphs
    .filter((g) => g.kind === 'workflow')
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((g) => grow(g.key, new Set()));
  return onlyCustomized ? roots.filter(hasCustomized).map(prune) : roots;
};

const Branch = ({ node }: { node: MapNode }) => (
  <li
    className={classNamesOf(
      'flex flex-col gap-2 border-l-2 pl-3',
      hasCustomized(node) ? 'border-custom' : 'border-border'
    )}
  >
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <TextLink to={`/workflows/${node.id}`}>{node.name}</TextLink>
      <code className="text-surface-fg-muted font-mono text-xs">{node.key}</code>
      {node.customized ? <ScopeBadge scope={node.scope} /> : null}
      <RoleBadge role={node.role} />
    </span>
    {node.tables.length || node.children.length ? (
      <ul className="flex flex-col gap-2">
        {node.tables.map((t) => (
          <li
            key={`table:${t.key}`}
            className={classNamesOf(
              'flex flex-wrap items-center gap-2 border-l-2 pl-3 text-sm',
              isCustom(t.scope) ? 'border-custom' : 'border-border'
            )}
          >
            <TableIcon aria-hidden="true" className="text-surface-fg-muted size-4" />
            <TextLink to={`/tables/${t.id}`}>{t.name}</TextLink>
            {isCustom(t.scope) ? <ScopeBadge scope={t.scope} /> : null}
          </li>
        ))}
        {node.children.map((c) => (
          <Branch key={c.key} node={c} />
        ))}
      </ul>
    ) : null}
  </li>
);

export const CustomizationMapView = ({
  map,
  showAll
}: {
  map: CustomizationMap;
  showAll: boolean;
}) => {
  const roots = buildMap(map, !showAll);
  return (
    <Page
      title="Customization Map"
      backTo="/workflows"
      backLabel="Back to Workflows"
      actions={
        <ButtonLink
          to={showAll ? CUSTOMIZED_PATH : `${CUSTOMIZED_PATH}?all=shown`}
          variant="outline"
        >
          {showAll ? (
            <EyeOffIcon aria-hidden="true" className="size-4" />
          ) : (
            <EyeIcon aria-hidden="true" className="size-4" />
          )}
          {showAll ? 'Show Only Changes' : 'Show Everything'}
        </ButtonLink>
      }
    >
      {roots.length ? (
        roots.map((root) => (
          <SectionPanel
            key={root.key}
            title={root.name}
            description={
              hasCustomized(root)
                ? 'Highlighted branches lead to a copy or table your organization or agency changed.'
                : 'Runs as built.'
            }
            {...(hasCustomized(root) ? { accent: 'custom' as const } : {})}
          >
            <ul className="flex flex-col gap-2">
              <Branch node={root} />
            </ul>
          </SectionPanel>
        ))
      ) : (
        <EmptyState title="Nothing Customized Yet">
          Every workflow runs as built. Override a subworkflow or a table to see it here.
        </EmptyState>
      )}
    </Page>
  );
};

export const CustomizationMapPage = ({
  client,
  live,
  showAll
}: {
  client: WorkflowsClient;
  live: Live;
  showAll: boolean;
}) => {
  const map = useResource('graphs:map', client.map);
  useReconnect(live, map.reload);
  if (map.error) return <PageFailure message={map.error.message} />;
  if (!map.data) return <PageLoading />;
  return <CustomizationMapView map={map.data} showAll={showAll} />;
};
