import { formatDateTime, formatMonth } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Period, PeriodsClient } from './client.ts';

export const PERIODS_PATH = '/periods';

const PERIOD_TABLE = { sorts: { period: 'desc' }, sort: 'period' } as const;

const PeriodsTable = ({
  periods,
  sorting
}: {
  periods: readonly Period[];
  sorting: TableSorting;
}) => (
  <Table
    label="Accounting periods"
    sorting={sorting}
    head={[{ label: 'Period', sort: 'period' }, { label: 'Closed' }, { label: 'Closed By' }]}
  >
    {periods.map((p) => (
      <TableRow key={p.period_on}>
        <TableCell>
          <span className="font-medium">{formatMonth(p.period_on)}</span>
        </TableCell>
        <TableCell kind="date" isMuted>
          {formatDateTime(p.closed_at)}
        </TableCell>
        <TableCell isMuted={!p.closed_by}>{p.closed_by ?? emptyValue}</TableCell>
      </TableRow>
    ))}
  </Table>
);

export const PeriodsPage = ({ client, live }: { client: PeriodsClient; live: Live }) => {
  const table = useTableState(PERIODS_PATH, PERIOD_TABLE);
  const periods = useResource(`periods:${table.apiQuery}`, (signal) =>
    client.search(table.apiQuery, signal)
  );
  useReconnect(live, periods.reload);
  return (
    <Page
      title="Accounting Periods"
      description="Months closed by Close Period. Postings dated in a closed month are posted to the next open month, and a closed month cannot be reopened."
    >
      {periods.error ? (
        <Alert>{periods.error.message}</Alert>
      ) : periods.data?.items.length ? (
        <>
          <PeriodsTable periods={periods.data.items} sorting={table} />
          <Pagination label="Accounting periods" total={periods.data.total} state={table} />
        </>
      ) : periods.loading ? (
        <PageLoading />
      ) : (
        <EmptyState title="No Closed Periods">
          On the first of each month, Close Period opens a task to close the month before.
        </EmptyState>
      )}
    </Page>
  );
};
