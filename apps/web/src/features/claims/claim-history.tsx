import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { formatCents, formatDate, formatDateTime } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { type Page as ListPage, useTableState } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import { EVENT_LABELS, fileLinkClasses } from './claim-files.tsx';
import type { ClaimEvent } from './client.ts';

export const paymentDetailsOf = (
  e: Pick<ClaimEvent, 'paid_on' | 'check_number' | 'payer_claim_number'>
) =>
  [
    e.paid_on ? `Paid ${formatDate(e.paid_on)}` : '',
    e.check_number ? `Check or EFT ${e.check_number}` : '',
    e.payer_claim_number ? `Payer claim ${e.payer_claim_number}` : ''
  ]
    .filter(Boolean)
    .join(' · ');

export const amountOf = (e: Pick<ClaimEvent, 'kind' | 'paid_cents' | 'adjusted_cents'>) =>
  e.kind === 'refunded'
    ? `${formatCents(Math.abs(e.paid_cents))} refunded`
    : [
        e.paid_cents ? `${formatCents(e.paid_cents)} paid` : '',
        e.adjusted_cents ? `${formatCents(e.adjusted_cents)} adjusted` : ''
      ]
        .filter(Boolean)
        .join(' · ');

const HISTORY_TABLE = {
  prefix: 'history',
  sorts: { when: 'desc', event: 'asc', payer: 'asc', amount: 'desc' },
  sort: 'when'
} as const;

export const useHistoryTable = (claimId: string) =>
  useTableState(`/claims/${claimId}`, HISTORY_TABLE);

export const ClaimHistory = ({
  claimId,
  history,
  documentUrl,
  fileUrl
}: {
  claimId: string;
  history: Resource<ListPage<ClaimEvent>>;
  documentUrl: (eventId: string) => string;
  fileUrl?: ((batchId: string) => string) | undefined;
}) => {
  const table = useHistoryTable(claimId);
  return history.error ? (
    <Alert>{history.error.message}</Alert>
  ) : history.data?.items.length ? (
    <>
      <EventsTable
        events={history.data.items}
        sorting={table}
        documentUrl={documentUrl}
        fileUrl={fileUrl}
      />
      <Pagination label="Claim history" total={history.data.total} state={table} />
    </>
  ) : history.loading ? (
    <PageLoading />
  ) : (
    <EmptyText>Nothing has happened on this claim yet.</EmptyText>
  );
};

export const EventsTable = ({
  events,
  sorting,
  documentUrl,
  fileUrl
}: {
  events: readonly ClaimEvent[];
  sorting?: TableSorting;
  documentUrl: (eventId: string) => string;
  fileUrl?: ((batchId: string) => string) | undefined;
}) => (
  <Table
    label="Claim history"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'When', sort: 'when' },
      { label: 'Event', sort: 'event' },
      { label: 'Payer', sort: 'payer' },
      { label: 'Amount', sort: 'amount' },
      { label: 'Note', isSecondary: true }
    ]}
  >
    {events.map((e) => (
      <TableRow key={e.id}>
        <TableCell kind="date" isMuted>
          {formatDateTime(e.created_at)}
        </TableCell>
        <TableCell>
          <span className="font-medium">{EVENT_LABELS[e.kind]}</span>
        </TableCell>
        <TableCell>{e.payer ?? (e.kind === 'response' ? 'Patient' : emptyValue)}</TableCell>
        <TableCell kind="numeric">{amountOf(e)}</TableCell>
        <TableCell isSecondary>
          <span className="flex flex-col gap-0.5">
            {paymentDetailsOf(e) ? (
              <span className="text-surface-fg-muted text-xs">{paymentDetailsOf(e)}</span>
            ) : null}
            <span className="flex items-center gap-3">
              {e.note}
              {e.has_document ? (
                <a
                  href={documentUrl(e.id)}
                  target="_blank"
                  rel="noopener"
                  className={fileLinkClasses}
                >
                  <FileTextIcon aria-hidden="true" className="size-4" />
                  View PDF
                </a>
              ) : null}
              {e.batch_id && fileUrl ? (
                <a href={fileUrl(e.batch_id)} download className={fileLinkClasses}>
                  <DownloadIcon aria-hidden="true" className="size-4" />
                  837P File #{e.batch_number}
                </a>
              ) : null}
            </span>
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);
