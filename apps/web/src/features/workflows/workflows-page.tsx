import { type EventDef, entryTrigger, TRIGGER_KIND_LABELS, triggerSummary } from '@ugula/graph';
import { PlusIcon } from 'lucide-react';
import { useContext, useState } from 'react';
import { eventLabel } from '../../shared/graph/catalog.ts';
import { WorkflowEventsContext } from '../../shared/graph/pins.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { EditLink, RowActions, RunLink } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type FilterValues, type SearchView, useSearchState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphKind, GraphSummary, WorkflowsClient } from './client.ts';
import { SCOPE_FILTER, ScopeBadge, StaleBadge } from './scope-badges.tsx';
import { KIND_FILTER, kindLabel, WorkflowDetailsDialog } from './workflow-details.tsx';

type WorkflowsPageProps = {
  client: WorkflowsClient;
  live: Live;
};

export const WORKFLOWS_PATH = '/workflows';

export const GRAPH_TABLE = {
  sorts: { name: 'asc', kind: 'desc', updated: 'desc' },
  sort: 'name',
  filters: ['kind', 'scope'],
  defaults: { kind: ['workflow'] }
} as const;

export const newKindOf = (filters: FilterValues): GraphKind => {
  const [only, ...rest] = filters.kind ?? [];
  return only === 'node' && !rest.length ? 'node' : 'workflow';
};

export const startsLabel = (
  g: Pick<GraphSummary, 'kind' | 'trigger'>,
  events: readonly EventDef[]
) =>
  g.kind === 'workflow'
    ? (triggerSummary(entryTrigger({ trigger: g.trigger }), (type) => eventLabel(events, type)) ??
      TRIGGER_KIND_LABELS.manual)
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
              {g.overriddenBy ? <Badge intent="custom">Has Custom Copy</Badge> : null}
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

export const WorkflowsPage = ({ client, live }: WorkflowsPageProps) => {
  const search = useSearchState(WORKFLOWS_PATH, GRAPH_TABLE);
  const graphs = useResource(`graphs:${search.apiQuery}`, (signal) =>
    client.search(search.apiQuery, signal)
  );
  useReconnect(live, graphs.reload);
  const newKind = newKindOf(search.filters);
  const [isCreating, setCreating] = useState(false);
  const addLabel = newKind === 'node' ? 'New Subworkflow' : 'New Workflow';
  return (
    <Page
      title="Workflows"
      actions={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          {addLabel}
        </Button>
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
        label="Workflows"
        path={WORKFLOWS_PATH}
        search={search}
        results={graphs}
        filters={[KIND_FILTER, SCOPE_FILTER]}
        empty={{ title: 'No Workflows Yet' }}
      >
        {(items) => <WorkflowsTable graphs={items} search={search} />}
      </Search>
    </Page>
  );
};
