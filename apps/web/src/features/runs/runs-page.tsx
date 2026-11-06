import { formatDateTime } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { FilterSelect } from '../../shared/ui/filter-select.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import {
  RUN_STATUSES,
  type RunStatus,
  RunStatusBadge,
  runStatusStyles
} from '../../shared/ui/run-status-badge.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useFilterHref, useSearchState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { RunSummary, RunsClient } from './client.ts';

type RunsPageProps = {
  client: RunsClient;
  live: Live;
  status: RunStatus | null;
};

const PATH = '/runs';

export const statusOptions = (filterHref: (name: string, value: string | null) => string) => [
  { value: '', label: 'All Statuses', href: filterHref('status', null) },
  ...RUN_STATUSES.map((s) => ({
    value: s,
    label: runStatusStyles[s].label,
    href: filterHref('status', s)
  }))
];

const RUN_TABLE = {
  sorts: { started: 'desc', workflow: 'asc', status: 'asc', finished: 'desc' },
  sort: 'started'
} as const;

export const RunsTable = ({
  runs,
  search
}: {
  runs: readonly RunSummary[];
  search?: SearchView;
}) => (
  <Table
    label="Workflow runs"
    {...(search ? { sorting: search } : {})}
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
            <Highlight text={r.name} query={search?.q ?? ''} />{' '}
            <span className="text-surface-fg-muted font-normal">v{r.version}</span>
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
            <Highlight text={r.error_message ?? ''} query={search?.q ?? ''} />
          </span>
        </TableCell>
        <TableCell kind="actions">
          <RowActions>
            <OpenLink
              to={`/runs/${r.id}`}
              name={`run ${r.name} started ${formatDateTime(r.created_at)}`}
            />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const RunsPage = ({ client, live, status }: RunsPageProps) => {
  const search = useSearchState(PATH, RUN_TABLE);
  const filterHref = useFilterHref(PATH);
  const runs = useResource(
    `runs:${status ?? 'all'}:${search.apiQuery}`,
    (signal) => client.list(status, search.apiQuery, signal),
    30_000
  );
  const ids = runs.data?.items.map((r) => r.id) ?? [];
  useLive(
    live,
    (e) => e.kind === 'run' && isOnPage(e.id, search.page, ids),
    runs.reload,
    LIST_RELOAD_MS
  );
  return (
    <Page title="Runs">
      <Search
        label="Runs"
        path={PATH}
        search={search}
        results={runs}
        filters={
          <FilterSelect
            id="runs-status"
            label="Status"
            value={status ?? ''}
            options={statusOptions(filterHref)}
          />
        }
        isFiltered={status !== null}
        empty={{ title: 'No Runs Yet', children: 'Runs show up here as workflows start.' }}
      >
        {(items) => <RunsTable runs={items} search={search} />}
      </Search>
    </Page>
  );
};
