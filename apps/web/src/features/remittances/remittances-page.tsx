import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import type { ColumnFilter } from '../../shared/ui/column-filters.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { RemittanceSummary, RemittancesClient } from './client.ts';

export const REMITTANCES_PATH = '/remittances';

const REMITTANCE_TABLE = {
  sorts: { received: 'desc', paid: 'desc', payer: 'asc', total: 'desc' },
  sort: 'received',
  filters: ['state']
} as const;

const REMITTANCE_FILTERS: readonly ColumnFilter[] = [{ key: 'state', label: 'Reconciled' }];

export const remittanceName = (r: Pick<RemittanceSummary, 'payer_name' | 'trace_number'>) =>
  [r.payer_name ?? 'Unknown payer', r.trace_number].filter(Boolean).join(' ');

export const RemittanceState = ({
  remittance: r
}: {
  remittance: Pick<RemittanceSummary, 'reconciled_at' | 'is_balanced' | 'unmatched_count'>;
}) =>
  r.reconciled_at ? (
    <Badge intent="success">Reconciled</Badge>
  ) : !r.is_balanced || r.unmatched_count ? (
    <Badge intent="warning">Needs Reconciling</Badge>
  ) : (
    <Badge intent="info">Open</Badge>
  );

export const RemittancesTable = ({
  remittances,
  search
}: {
  remittances: readonly RemittanceSummary[];
  search: SearchView;
}) => (
  <Table
    label="Remittances"
    sorting={search}
    head={[
      { label: 'Payer', sort: 'payer' },
      { label: 'Paid', sort: 'paid' },
      { label: 'Amount', sort: 'total' },
      { label: 'Claims' },
      { label: 'State' },
      { label: 'Received', isSecondary: true, sort: 'received' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {remittances.map((r) => (
      <TableRow key={r.id}>
        <TableCell>
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">
              <Highlight text={r.payer_name ?? 'Unknown payer'} query={search.q} />
            </span>
            {r.trace_number ? (
              <span className="text-surface-fg-muted text-xs">
                <Highlight text={r.trace_number} query={search.q} />
              </span>
            ) : null}
          </span>
        </TableCell>
        <TableCell kind="date">{formatDate(r.paid_on)}</TableCell>
        <TableCell kind="numeric">{formatCents(r.total_cents)}</TableCell>
        <TableCell kind="numeric">
          {r.payment_count}
          {r.unmatched_count ? (
            <span className="text-warning-text text-xs"> ({r.unmatched_count} unmatched)</span>
          ) : null}
        </TableCell>
        <TableCell>
          <RemittanceState remittance={r} />
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDate(r.created_at)}
        </TableCell>
        <TableCell kind="actions">
          <RowActions>
            <OpenLink
              to={withBack(`${REMITTANCES_PATH}/${r.id}`, search.href)}
              name={remittanceName(r)}
            />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const RemittancesPage = ({ client, live }: { client: RemittancesClient; live: Live }) => {
  const search = useSearchState(REMITTANCES_PATH, REMITTANCE_TABLE);
  const remittances = useResource(`remittances:${search.apiQuery}`, () =>
    client.search(search.apiQuery)
  );
  useReconnect(live, remittances.reload);
  return (
    <Page
      title="Remittances"
      description="Each payment a payer sent, posted to its claims from the 835."
    >
      <Search
        label="Remittances"
        path={REMITTANCES_PATH}
        search={search}
        results={remittances}
        filters={REMITTANCE_FILTERS}
        empty={{
          title: 'No Remittances Yet',
          children: 'Remittances appear here once the clearinghouse sends 835 files.'
        }}
      >
        {(items) => <RemittancesTable remittances={items} search={search} />}
      </Search>
    </Page>
  );
};
