import { formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { FilterPills } from '../../shared/ui/filter-pills.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { RunStatus, RunSummary, RunsClient } from './client.ts';
import { RunStatusBadge } from './run-status-badge.tsx';

export type RunsPageProps = {
  client: RunsClient;
  live: Live;
  status: RunStatus | null;
};

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'suspended', label: 'Waiting' },
  { value: 'faulted', label: 'Stuck' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' }
] as const;

export const RUN_TABLE = {
  sorts: { started: 'desc', workflow: 'asc', status: 'asc', finished: 'desc' },
  sort: 'started'
} as const;

export const RunsTable = ({
  runs,
  sorting
}: {
  runs: readonly RunSummary[];
  sorting?: TableSorting;
}) => (
  <Table
    label="Workflow runs"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Workflow', sort: 'workflow' },
      { label: 'Status', sort: 'status' },
      { label: 'Started', sort: 'started' },
      { label: 'Finished', isSecondary: true, sort: 'finished' },
      { label: 'Problem', isSecondary: true }
    ]}
  >
    {runs.map((r) => (
      <TableRow key={r.id}>
        <TableCell>
          <TextLink to={`/runs/${r.id}`}>
            {r.name} <span className="text-surface-fg-muted font-normal">v{r.version}</span>
          </TextLink>
        </TableCell>
        <TableCell>
          <RunStatusBadge status={r.status} />
        </TableCell>
        <TableCell kind="date" isMuted>
          {formatDateTime(r.created_at)}
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDateTime(r.completed_at)}
        </TableCell>
        <TableCell isSecondary>
          <span
            className="text-danger block max-w-80 truncate"
            title={r.error_message ?? undefined}
          >
            {r.error_message ?? ''}
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const RunsPage = ({ client, live, status }: RunsPageProps) => {
  const table = useTableState('/runs', RUN_TABLE);
  const filterHref = useFilterHref('/runs');
  const runs = useResource(
    `runs:${status ?? 'all'}:${table.apiQuery}`,
    () => client.list(status, table.apiQuery),
    30_000
  );
  useLive(live, (e) => e.kind === 'run', runs.reload);
  return (
    <Page
      title="Runs"
      description="Every workflow run, including the ones waiting on people or stuck on errors."
    >
      <FilterPills
        label="Filter runs by status"
        options={FILTERS.map((f) => ({
          label: f.label,
          href: filterHref('status', f.value || null),
          isSelected: (status ?? '') === f.value
        }))}
      />
      {runs.error ? <Alert>{runs.error.message}</Alert> : null}
      {runs.data?.items.length ? (
        <>
          <RunsTable runs={runs.data.items} sorting={table} />
          <Pagination label="Runs" total={runs.data.total} state={table} />
        </>
      ) : runs.loading ? (
        <PageLoading />
      ) : (
        <EmptyState reason="noMatches" title="No Runs">
          No runs match this filter.
        </EmptyState>
      )}
    </Page>
  );
};
