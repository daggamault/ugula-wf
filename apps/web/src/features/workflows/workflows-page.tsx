import { MapIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { EditLink, IconLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import {
  type SearchView,
  useFilterHref,
  useSearchState,
  withBack
} from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphKind, GraphSummary, WorkflowsClient } from './client.ts';
import { RoleBadge, ScopeBadge, StaleBadge } from './scope-badges.tsx';

type WorkflowsPageProps = {
  client: WorkflowsClient;
  live: Live;
  show: GraphFilter;
};

export const WORKFLOWS_PATH = '/workflows';

export const CUSTOMIZED_PATH = `${WORKFLOWS_PATH}/customized`;

type GraphFilter = 'workflows' | 'blocks' | 'mine' | 'customized' | 'all';

const GRAPH_FILTERS: readonly { value: GraphFilter; label: string }[] = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'blocks', label: 'Subworkflows' },
  { value: 'mine', label: 'Your Copies' },
  { value: 'customized', label: 'Customized' },
  { value: 'all', label: 'All' }
];

export const graphFilterOf = (query: URLSearchParams): GraphFilter =>
  GRAPH_FILTERS.find((f) => f.value === query.get('kind'))?.value ?? 'workflows';

export const kindLabel = (kind: GraphKind) => (kind === 'workflow' ? 'Workflow' : 'Subworkflow');

export const GRAPH_TABLE = {
  sorts: { name: 'asc', key: 'asc', kind: 'desc', updated: 'desc' },
  sort: 'name'
} as const;

export const graphsQueryOf = (apiQuery: string, show: GraphFilter) => `${apiQuery}&show=${show}`;

export const WorkflowsTable = ({
  graphs,
  search
}: {
  graphs: readonly GraphSummary[];
  search: SearchView;
}) => (
  <Table
    label="Workflows and subworkflows"
    sorting={search}
    head={[
      { label: 'Name', sort: 'name' },
      { label: 'Key', isSecondary: true, sort: 'key' },
      { label: 'Kind', sort: 'kind' },
      'Scope',
      'Published',
      'Draft',
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {graphs.map((g) => (
      <TableRow key={g.id}>
        <TableCell>
          <span className="font-medium">
            <Highlight text={g.name} query={search.q} />
          </span>
        </TableCell>
        <TableCell isMuted isSecondary>
          <code className="font-mono text-xs">
            <Highlight text={g.key} query={search.q} />
          </code>
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-1">
            <Badge intent={g.kind === 'workflow' ? 'info' : undefined}>{kindLabel(g.kind)}</Badge>
            <RoleBadge role={g.role} />
          </span>
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-1">
            <ScopeBadge scope={g.scope} />
            {g.overriddenBy ? <Badge intent="custom">Has Your Copy</Badge> : null}
            <StaleBadge stale={g.isStale} />
          </span>
        </TableCell>
        <TableCell isMuted>{g.publishedVersion ? `v${g.publishedVersion}` : emptyValue}</TableCell>
        <TableCell isMuted>{g.draftVersion ? `v${g.draftVersion}` : emptyValue}</TableCell>
        <TableCell kind="actions">
          <RowActions>
            {g.kind === 'workflow' && g.publishedVersion ? (
              <IconLink
                to={`/runs/new?graph=${g.id}`}
                label={`Run ${g.name}`}
                tooltip="Run"
                icon={PlayIcon}
              />
            ) : null}
            <EditLink to={`${WORKFLOWS_PATH}/${g.id}`} name={g.name} />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const WorkflowsPage = ({ client, live, show }: WorkflowsPageProps) => {
  const search = useSearchState(WORKFLOWS_PATH, GRAPH_TABLE);
  const query = graphsQueryOf(search.apiQuery, show);
  const graphs = useResource(`graphs:${query}`, (signal) => client.search(query, signal));
  useReconnect(live, graphs.reload);
  const filterHref = useFilterHref(WORKFLOWS_PATH);
  const newKind: GraphKind = show === 'blocks' ? 'node' : 'workflow';
  const add = withBack(`${WORKFLOWS_PATH}/new?kind=${newKind}`, search.href);
  const addLabel = newKind === 'node' ? 'New Subworkflow' : 'New Workflow';
  return (
    <Page
      title="Workflows"
      description="Workflows that run on their own, and the subworkflows they are made of."
      actions={
        <>
          <ButtonLink to={CUSTOMIZED_PATH} variant="outline">
            <MapIcon aria-hidden="true" className="size-4" />
            Customization Map
          </ButtonLink>
          <ButtonLink to={add}>
            <PlusIcon aria-hidden="true" className="size-4" />
            {addLabel}
          </ButtonLink>
        </>
      }
    >
      <Search
        label={show === 'blocks' ? 'Subworkflows' : 'Workflows'}
        path={WORKFLOWS_PATH}
        search={search}
        results={graphs}
        filters={
          <FilterSelect
            id="workflows-kind"
            label="Show"
            value={show}
            options={GRAPH_FILTERS.map((f) => ({
              value: f.value,
              label: f.label,
              href: filterHref('kind', f.value === 'workflows' ? null : f.value)
            }))}
          />
        }
        empty={
          show === 'mine'
            ? {
                title: 'No Copies Yet',
                children:
                  'Your agency has no workflows of its own yet. Create one, or override a built-in one.'
              }
            : show === 'customized'
              ? {
                  title: 'Nothing Customized Yet',
                  children:
                    'Every workflow runs as built. Override one for your organization or agency to change it.'
                }
              : { title: 'Nothing Here Yet', children: 'Nothing matches this filter.' }
        }
      >
        {(items) => <WorkflowsTable graphs={items} search={search} />}
      </Search>
    </Page>
  );
};
