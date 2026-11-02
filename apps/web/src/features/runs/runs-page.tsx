import { ChevronRightIcon } from 'lucide-react';
import { formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import {
  RUN_STATUSES,
  type RunStatus,
  RunStatusBadge,
  runStatusStyles
} from '../../shared/ui/run-status-badge.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useFilterHref, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { RunSummary, RunsClient } from './client.ts';

export type RunsPageProps = {
  client: RunsClient;
  live: Live;
  status: RunStatus | null;
};

export const statusOptions = (filterHref: (name: string, value: string | null) => string) => [
  { value: '', label: 'All', href: filterHref('status', null) },
  ...RUN_STATUSES.map((s) => ({
    value: s,
    label: runStatusStyles[s].label,
    href: filterHref('status', s)
  }))
];

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
      { label: 'Problem', isSecondary: true },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {runs.map((r) => (
      <TableRow key={r.id}>
        <TableCell>
          <span className="font-medium">
            {r.name} <span className="text-surface-fg-muted font-normal">v{r.version}</span>
          </span>
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
        <TableCell kind="actions">
          <IconLink
            to={`/runs/${r.id}`}
            label={`Open run ${r.name} started ${formatDateTime(r.created_at)}`}
            icon={ChevronRightIcon}
          />
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
      <FilterSelect
        id="runs-status"
        label="Status"
        value={status ?? ''}
        options={statusOptions(filterHref)}
      />
      {runs.error ? (
        <Alert>{runs.error.message}</Alert>
      ) : runs.data?.items.length ? (
        <>
          <RunsTable runs={runs.data.items} sorting={table} />
          <Pagination label="Runs" total={runs.data.total} state={table} />
        </>
      ) : runs.loading ? (
        <PageLoading />
      ) : status ? (
        <EmptyState reason="noMatches" title="No Matching Runs">
          Nothing matches these filters.
        </EmptyState>
      ) : (
        <EmptyState title="No Runs Yet">Runs show up here as workflows start.</EmptyState>
      )}
    </Page>
  );
};
