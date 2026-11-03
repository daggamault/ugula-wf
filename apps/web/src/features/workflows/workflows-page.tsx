import { PlayIcon, PlusIcon } from 'lucide-react';
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

export type WorkflowsPageProps = {
  client: WorkflowsClient;
  show: GraphFilter;
};

export const WORKFLOWS_PATH = '/workflows';

export type GraphFilter = 'workflows' | 'blocks' | 'mine' | 'all';

export const GRAPH_FILTERS: readonly { value: GraphFilter; label: string }[] = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'blocks', label: 'Building Blocks' },
  { value: 'mine', label: "Your Agency's Copies" },
  { value: 'all', label: 'All' }
];

export const graphFilterOf = (query: URLSearchParams): GraphFilter =>
  GRAPH_FILTERS.find((f) => f.value === query.get('kind'))?.value ?? 'workflows';

export const kindLabel = (kind: GraphKind) => (kind === 'workflow' ? 'Workflow' : 'Building Block');

export const GRAPH_TABLE = {
  sorts: { name: 'asc', key: 'asc', kind: 'desc', updated: 'desc' },
  sort: 'name'
} as const;

/** The API query for one page of graphs: the search, its table state and the kind shown. */
export const graphsQueryOf = (apiQuery: string, show: GraphFilter) => `${apiQuery}&show=${show}`;

export const WorkflowsTable = ({
  graphs,
  search
}: {
  graphs: readonly GraphSummary[];
  search: SearchView;
}) => (
  <Table
    label="Workflows and building blocks"
    sorting={search}
    head={[
      { label: 'Name', sort: 'name' },
      { label: 'Key', isSecondary: true, sort: 'key' },
      { label: 'Kind', sort: 'kind' },
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
            {g.isSystem ? <Badge>System</Badge> : null}
            {g.overriddenBy ? <Badge intent="info">Has Your Copy</Badge> : null}
            {g.overrides ? <Badge intent="info">Your Copy</Badge> : null}
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

export const WorkflowsPage = ({ client, show }: WorkflowsPageProps) => {
  const search = useSearchState(WORKFLOWS_PATH, GRAPH_TABLE);
  const query = graphsQueryOf(search.apiQuery, show);
  const graphs = useResource(`graphs:${query}`, () => client.search(query));
  const filterHref = useFilterHref(WORKFLOWS_PATH);
  const newKind: GraphKind = show === 'blocks' ? 'node' : 'workflow';
  const add = withBack(`${WORKFLOWS_PATH}/new?kind=${newKind}`, search.href);
  const addLabel = newKind === 'node' ? 'New Building Block' : 'New Workflow';
  return (
    <Page
      title="Workflows"
      description="Workflows run on their own; building blocks are the smaller parts they are made of. Override a system one to change how your agency runs it."
      actions={
        <ButtonLink to={add}>
          <PlusIcon aria-hidden="true" className="size-4" />
          {addLabel}
        </ButtonLink>
      }
    >
      <div className="w-full sm:w-64">
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
      </div>
      <Search
        label={show === 'blocks' ? 'Building Blocks' : 'Workflows'}
        path={WORKFLOWS_PATH}
        search={search}
        results={graphs}
        empty={
          show === 'mine'
            ? {
                title: 'No Copies Yet',
                children:
                  'Your agency has no workflows of its own yet. Create one, or override a system one.'
              }
            : { title: 'Nothing Here Yet', children: 'Nothing matches this filter.' }
        }
      >
        {(items) => <WorkflowsTable graphs={items} search={search} />}
      </Search>
    </Page>
  );
};
