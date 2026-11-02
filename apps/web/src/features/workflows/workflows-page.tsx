import { PencilIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { pageOf, useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { GraphKind, GraphSummary, WorkflowsClient } from './client.ts';
import { NewWorkflowDialog } from './new-workflow-dialog.tsx';

export type WorkflowsPageProps = {
  client: WorkflowsClient;
  show: GraphFilter;
  search: string;
};

const PATH = '/workflows';

export type GraphFilter = 'workflows' | 'blocks' | 'mine' | 'all';

export const GRAPH_FILTERS: readonly { value: GraphFilter; label: string }[] = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'blocks', label: 'Building blocks' },
  { value: 'mine', label: "Your agency's copies" },
  { value: 'all', label: 'All' }
];

export const graphFilterOf = (query: URLSearchParams): GraphFilter =>
  GRAPH_FILTERS.find((f) => f.value === query.get('kind'))?.value ?? 'workflows';

const SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'q', label: 'Name', placeholder: 'Name or key' }
];

export const matchesFilter = (g: GraphSummary, show: GraphFilter) =>
  show === 'workflows'
    ? g.kind === 'workflow'
    : show === 'blocks'
      ? g.kind !== 'workflow'
      : show === 'mine'
        ? !g.isSystem
        : true;

export const matchesSearch = (g: GraphSummary, search: string) => {
  const needle = search.trim().toLowerCase();
  return !needle || g.name.toLowerCase().includes(needle) || g.key.toLowerCase().includes(needle);
};

export const kindLabel = (kind: GraphKind) => (kind === 'workflow' ? 'Workflow' : 'Building block');

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
          <span className="font-medium">{g.name}</span>
        </TableCell>
        <TableCell isMuted isSecondary>
          <code className="font-mono text-xs">{g.key}</code>
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-1">
            <Badge intent={g.kind === 'workflow' ? 'info' : undefined}>{kindLabel(g.kind)}</Badge>
            {g.isSystem ? <Badge>System</Badge> : null}
            {g.overriddenBy ? <Badge intent="info">Has your copy</Badge> : null}
            {g.overrides ? <Badge intent="info">Your copy</Badge> : null}
          </span>
        </TableCell>
        <TableCell isMuted>{g.publishedVersion ? `v${g.publishedVersion}` : emptyValue}</TableCell>
        <TableCell isMuted>{g.draftVersion ? `v${g.draftVersion}` : emptyValue}</TableCell>
        <TableCell kind="actions">
          <span className="flex items-center justify-end gap-2">
            {g.kind === 'workflow' && g.publishedVersion ? (
              <IconLink to={`/runs/new?graph=${g.id}`} label={`Run ${g.name}`} icon={PlayIcon} />
            ) : null}
            <IconLink to={`/workflows/${g.id}`} label={`Edit ${g.name}`} icon={PencilIcon} />
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const WorkflowsPage = ({ client, show, search }: WorkflowsPageProps) => {
  const graphs = useResource('graphs', client.list);
  const table = useTableState(PATH, GRAPH_TABLE);
  const filterHref = useFilterHref(PATH);
  const shown =
    graphs.data?.filter((g) => matchesFilter(g, show) && matchesSearch(g, search)) ?? [];
  const newKind: GraphKind = show === 'blocks' ? 'node' : 'workflow';
  const [creating, setCreating] = useState(false);
  return (
    <Page
      title="Workflows"
      description="Workflows run on their own; building blocks are the smaller parts they are made of. Override a system one to change how your agency runs it."
      actions={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          New workflow
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-2">
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
        <SearchForm label="Search workflows" path={PATH} fields={SEARCH_FIELDS} />
      </div>
      {graphs.error ? (
        <Alert>{graphs.error.message}</Alert>
      ) : shown.length ? (
        <>
          <WorkflowsTable graphs={pageOf(shown, table, GRAPH_VALUES).items} sorting={table} />
          <Pagination label="Workflows" total={shown.length} state={table} />
        </>
      ) : graphs.loading ? (
        <PageLoading />
      ) : show === 'mine' && !search ? (
        <EmptyState title="No Copies Yet">
          Your agency has no workflows of its own yet. Create one, or override a system one.
        </EmptyState>
      ) : (
        <EmptyState reason="noMatches" title="No Matching Workflows">
          Nothing matches these filters.
        </EmptyState>
      )}
      <NewWorkflowDialog
        key={newKind}
        client={client}
        kind={newKind}
        open={creating}
        onClose={() => setCreating(false)}
      />
    </Page>
  );
};
