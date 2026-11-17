import { ADJUSTMENT_GROUPS, CLAIM_STATUS_LABELS, isClosedStatus } from '@ugula/billing';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { type Coded, CodeLabel, coded } from '../../shared/claims/code-text.tsx';
import { formatCents, formatDate, formatDateTime } from '../../shared/format.ts';
import { outcomeLabel } from '../../shared/task-outcomes.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { type Page as ListPage, useTableState } from '../../shared/url-state.ts';
import type { Resource } from '../../shared/use-resource.ts';
import { EVENT_LABELS, fileLinkClasses } from './claim-files.tsx';
import type { ClaimEvent, EventDecision } from './client.ts';

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

type Reason = { group: string | null; value: Coded; amount: string | null };

export const reasonsOf = (e: Pick<ClaimEvent, 'adjustments' | 'remarks'>): Reason[] => [
  ...(e.adjustments ?? []).map((a) => ({
    group: ADJUSTMENT_GROUPS[a.group],
    value: coded(a.description, `${a.group}-${a.reason}`),
    amount: formatCents(a.cents)
  })),
  ...(e.remarks ?? []).map((r) => ({
    group: null,
    value: coded(r.description, r.code),
    amount: null
  }))
];

export const amountOf = (e: Pick<ClaimEvent, 'kind' | 'paid_cents' | 'adjusted_cents'>) =>
  e.kind === 'refunded'
    ? `${formatCents(Math.abs(e.paid_cents))} refunded`
    : [
        e.paid_cents ? `${formatCents(e.paid_cents)} paid` : '',
        e.adjusted_cents ? `${formatCents(e.adjusted_cents)} adjusted` : ''
      ]
        .filter(Boolean)
        .join(' · ');

export const decisionText = (d: EventDecision) => `${d.task}: ${outcomeLabel(d.outcome)}`;

export const noteOf = (e: Pick<ClaimEvent, 'kind' | 'note'>) =>
  e.kind === 'closed' && isClosedStatus(e.note) ? `As ${CLAIM_STATUS_LABELS[e.note]}` : e.note;

export const byOf = (e: Pick<ClaimEvent, 'by'>) => e.by ?? 'Automatic';

const DecisionNote = ({ decision }: { decision: EventDecision }) => (
  <span className="flex flex-col gap-0.5">
    <span className="font-medium">{decisionText(decision)}</span>
    {decision.values.length ? (
      <ul className="text-surface-fg-muted flex flex-col gap-0.5 text-xs">
        {decision.values.map((v) => (
          <li key={v.label}>
            {v.label}: {v.value}
          </li>
        ))}
      </ul>
    ) : null}
  </span>
);

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
      { label: 'By' },
      { label: 'Payer', sort: 'payer' },
      { label: 'Amount', sort: 'amount' },
      { label: 'Note' }
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
        <TableCell isMuted={!e.by}>{byOf(e)}</TableCell>
        <TableCell>{e.payer ?? (e.kind === 'response' ? 'Patient' : emptyValue)}</TableCell>
        <TableCell kind="numeric">{amountOf(e)}</TableCell>
        <TableCell kind="wrap">
          <span className="flex flex-col gap-0.5">
            {e.decision ? <DecisionNote decision={e.decision} /> : null}
            {paymentDetailsOf(e) ? (
              <span className="text-surface-fg-muted text-xs">{paymentDetailsOf(e)}</span>
            ) : null}
            {reasonsOf(e).length ? (
              <ul className="text-surface-fg-muted flex flex-col gap-0.5 text-xs">
                {reasonsOf(e).map((r) => (
                  <li key={`${r.group}:${r.value.code ?? r.value.text}`}>
                    {r.group ? `${r.group}: ` : null}
                    <CodeLabel value={r.value} isInline />
                    {r.amount ? ` · ${r.amount}` : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <span className="flex items-center gap-3">
              {noteOf(e)}
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
