import { PlayIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { pageOf, useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphSummary, WorkflowsClient } from './client.ts';
import { NewWorkflowDialog } from './new-workflow-dialog.tsx';

export type WorkflowsPageProps = {
  client: WorkflowsClient;
  show: GraphFilter;
};

export type GraphFilter = 'all' | 'workflows' | 'blocks' | 'mine';

export const GRAPH_FILTERS: readonly { value: GraphFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'workflows', label: 'Workflows' },
  { value: 'blocks', label: 'Building blocks' },
  { value: 'mine', label: 'Your agency' }
];

export const matchesFilter = (g: GraphSummary, show: GraphFilter) =>
  show === 'workflows'
    ? g.kind === 'workflow'
    : show === 'blocks'
      ? g.kind !== 'workflow'
      : show === 'mine'
        ? !g.isSystem
        : true;

export const GRAPH_TABLE = {
  sorts: { name: 'asc', key: 'asc', kind: 'desc', updated: 'desc' },
  sort: 'name'
} as const;

export const GRAPH_VALUES = {
  name: (g: GraphSummary) => g.name,
  key: (g: GraphSummary) => g.key,
  kind: (g: GraphSummary) => `${g.kind} ${g.name}`,
  updated: (g: GraphSummary) => g.updatedAt
};

export const WorkflowsTable = ({
  graphs,
  sorting
}: {
  graphs: readonly GraphSummary[];
  sorting?: TableSorting;
}) => (
  <Table
    label="Workflows and building blocks"
    {...(sorting ? { sorting } : {})}
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
          <TextLink to={`/workflows/${g.id}`}>{g.name}</TextLink>
        </TableCell>
        <TableCell isMuted isSecondary>
          <code className="font-mono text-xs">{g.key}</code>
        </TableCell>
        <TableCell>
          <span className="flex gap-1.5">
            <Badge intent={g.kind === 'workflow' ? 'info' : undefined}>
              {g.kind === 'workflow' ? 'Workflow' : 'Building block'}
            </Badge>
            {g.isSystem ? <Badge intent="warning">System</Badge> : null}
            {g.overriddenBy ? <Badge intent="info">Overridden</Badge> : null}
            {g.overrides ? <Badge intent="info">Override</Badge> : null}
          </span>
        </TableCell>
        <TableCell isMuted>{g.publishedVersion ? `v${g.publishedVersion}` : emptyValue}</TableCell>
        <TableCell isMuted>{g.draftVersion ? `v${g.draftVersion}` : emptyValue}</TableCell>
        <TableCell kind="actions">
          {g.kind === 'workflow' && g.publishedVersion ? (
            <ButtonLink
              to={`/runs/new?graph=${g.id}`}
              variant="outline"
              size="sm"
              aria-label={`Run ${g.name}`}
            >
              <PlayIcon aria-hidden="true" className="size-4" />
              Run
            </ButtonLink>
          ) : null}
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const WorkflowsPage = ({ client, show }: WorkflowsPageProps) => {
  const graphs = useResource('graphs', client.list);
  const table = useTableState('/workflows', GRAPH_TABLE);
  const filterHref = useFilterHref('/workflows');
  const shown = graphs.data?.filter((g) => matchesFilter(g, show)) ?? [];
  const [creating, setCreating] = useState(false);
  return (
    <Page
      title="Workflows"
      description="Workflows run on their own; building blocks are the smaller graphs they are made of. Override a system one to change how your agency runs it."
      actions={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          New
        </Button>
      }
    >
      {graphs.error ? <Alert>{graphs.error.message}</Alert> : null}
      <FilterPills
        label="Filter workflows"
        options={GRAPH_FILTERS.map((f) => ({
          label: f.label,
          href: filterHref('show', f.value === 'all' ? null : f.value),
          isSelected: f.value === show
        }))}
      />
      {shown.length ? (
        <>
          <WorkflowsTable graphs={pageOf(shown, table, GRAPH_VALUES).items} sorting={table} />
          <Pagination label="Workflows" total={shown.length} state={table} />
        </>
      ) : graphs.loading ? (
        <PageLoading />
      ) : (
        <EmptyState reason="noMatches" title="Nothing Here">
          {show === 'mine'
            ? 'Your agency has no workflows of its own yet. Create one, or override a system one.'
            : 'Nothing matches this filter.'}
        </EmptyState>
      )}
      <NewWorkflowDialog client={client} open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
};
