import { type EventDef, entryTrigger, triggerSummary } from '@ugula/graph';
import { MapIcon, PlusIcon } from 'lucide-react';
import { useContext, useState } from 'react';
import { eventLabel } from '../../shared/graph/catalog.ts';
import { WorkflowEventsContext } from '../../shared/graph/pins.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { EditLink, RowActions, RunLink } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useFilterHref, useSearchState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphKind, GraphSummary, WorkflowsClient } from './client.ts';
import { ScopeBadge, StaleBadge } from './scope-badges.tsx';
import { kindLabel, WorkflowDetailsDialog } from './workflow-details.tsx';

type WorkflowsPageProps = {
  client: WorkflowsClient;
  live: Live;
  show: GraphFilter;
};

export const WORKFLOWS_PATH = '/workflows';

export const CUSTOMIZED_PATH = `${WORKFLOWS_PATH}/customized`;

type GraphFilter = 'workflows' | 'blocks' | 'customized';

const GRAPH_FILTERS: readonly { value: GraphFilter; label: string }[] = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'blocks', label: 'Subworkflows' },
  { value: 'customized', label: 'Customized' }
];

export const graphFilterOf = (query: URLSearchParams): GraphFilter =>
  GRAPH_FILTERS.find((f) => f.value === query.get('kind'))?.value ?? 'workflows';

export const GRAPH_TABLE = {
  sorts: { name: 'asc', kind: 'desc', updated: 'desc' },
  sort: 'name'
} as const;

export const graphsQueryOf = (apiQuery: string, show: GraphFilter) => `${apiQuery}&show=${show}`;

export const startsLabel = (
  g: Pick<GraphSummary, 'kind' | 'trigger'>,
  events: readonly EventDef[]
) =>
  g.kind === 'workflow'
    ? (triggerSummary(entryTrigger({ trigger: g.trigger }), (type) => eventLabel(events, type)) ??
      'When Run')
    : null;

export const WorkflowsTable = ({
  graphs,
  search
}: {
  graphs: readonly GraphSummary[];
  search: SearchView;
}) => {
  const events = useContext(WorkflowEventsContext);
  return (
    <Table
      label="Workflows and subworkflows"
      sorting={search}
      head={[
        { label: 'Name', sort: 'name' },
        { label: 'Kind', sort: 'kind' },
        'Starts',
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
          <TableCell>
            <Badge intent={g.kind === 'workflow' ? 'info' : undefined}>{kindLabel(g.kind)}</Badge>
          </TableCell>
          <TableCell isMuted>{startsLabel(g, events) ?? emptyValue}</TableCell>
          <TableCell>
            <span className="flex flex-wrap items-center gap-2">
              <ScopeBadge scope={g.scope} />
              {g.overriddenBy ? <Badge intent="custom">Has Your Copy</Badge> : null}
              <StaleBadge stale={g.isStale} />
            </span>
          </TableCell>
          <TableCell isMuted>
            {g.publishedVersion ? `v${g.publishedVersion}` : emptyValue}
          </TableCell>
          <TableCell isMuted>{g.draftVersion ? `v${g.draftVersion}` : emptyValue}</TableCell>
          <TableCell kind="actions">
            <RowActions>
              {g.kind === 'workflow' && g.publishedVersion ? (
                <RunLink to={`/runs/new?graph=${g.id}`} name={g.name} />
              ) : null}
              <EditLink to={`${WORKFLOWS_PATH}/${g.id}`} name={g.name} />
            </RowActions>
          </TableCell>
        </TableRow>
      ))}
    </Table>
  );
};

export const WorkflowsPage = ({ client, live, show }: WorkflowsPageProps) => {
  const search = useSearchState(WORKFLOWS_PATH, GRAPH_TABLE);
  const query = graphsQueryOf(search.apiQuery, show);
  const graphs = useResource(`graphs:${query}`, (signal) => client.search(query, signal));
  useReconnect(live, graphs.reload);
  const filterHref = useFilterHref(WORKFLOWS_PATH);
  const newKind: GraphKind = show === 'blocks' ? 'node' : 'workflow';
  const [isCreating, setCreating] = useState(false);
  const addLabel = newKind === 'node' ? 'New Subworkflow' : 'New Workflow';
  return (
    <Page
      title="Workflows"
      actions={
        <>
          <ButtonLink to={CUSTOMIZED_PATH} variant="outline">
            <MapIcon aria-hidden="true" className="size-4" />
            Customization Map
          </ButtonLink>
          <Button onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden="true" className="size-4" />
            {addLabel}
          </Button>
        </>
      }
    >
      {isCreating ? (
        <WorkflowDetailsDialog
          mode="create"
          kind={newKind}
          onClose={() => setCreating(false)}
          onSubmit={async (graph) => {
            const { id } = await client.create(graph);
            navigate(`${WORKFLOWS_PATH}/${id}`, { force: true });
          }}
        />
      ) : null}
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
          show === 'customized'
            ? {
                title: 'Nothing Customized Yet',
                children:
                  'Every workflow runs as built. Customize a built-in one or create your own to change it.'
              }
            : { title: 'Nothing Here Yet', children: 'Nothing matches this filter.' }
        }
      >
        {(items) => <WorkflowsTable graphs={items} search={search} />}
      </Search>
    </Page>
  );
};
