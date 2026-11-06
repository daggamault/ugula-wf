import { nameKey } from '@ugula/billing';
import type { ReactNode } from 'react';
import type { ClaimSummary } from '../../shared/claims/claim-detail.ts';
import { formatCents, formatDate } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { assigneeOf, queueInfo } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight, NumberHighlight } from '../../shared/ui/highlight.tsx';
import { OpenLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { type TableState, useTableState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';
import type { ClaimSearch, ClaimsClient } from './client.ts';

type ClaimsPageProps = {
  client: ClaimsClient;
  live: Live;
  search: ClaimSearch;
  me: string;
};

const PATH = '/claims';

export const CLAIM_TABLE = {
  sorts: {
    number: 'desc',
    created: 'desc',
    service: 'desc',
    patient: 'asc',
    pcr: 'asc',
    encounter: 'desc',
    total: 'desc',
    balance: 'desc',
    status: 'asc',
    waiting: 'asc'
  },
  sort: 'created'
} as const;

export const CLAIM_SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'firstName', label: 'First Name' },
  { name: 'lastName', label: 'Last Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
  { name: 'number', label: 'Number', placeholder: 'Claim, Patient or Encounter #' }
];

const WaitingOn = ({ claim, me }: { claim: ClaimSummary; me: string }) =>
  claim.task_id ? (
    <span className="flex flex-col gap-0.5">
      <span className={claim.task_kind === 'fault' ? 'text-danger font-medium' : 'font-medium'}>
        {claim.task_title}
        {claim.open_tasks > 1 ? (
          <span className="text-surface-fg-muted font-normal"> +{claim.open_tasks - 1} more</span>
        ) : null}
      </span>
      <span className="text-surface-fg-muted text-xs">
        {queueInfo(claim.task_queue ?? '').label} · {assigneeOf(claim.task_assignee_email, me)}
      </span>
    </span>
  ) : (
    <span className="text-surface-fg-muted">{emptyValue}</span>
  );

export const ClaimsTable = ({
  claims,
  sorting,
  showPatient = true,
  back = '',
  search,
  me = ''
}: {
  claims: readonly ClaimSummary[];
  sorting?: TableSorting;
  showPatient?: boolean;
  back?: string;
  search?: ClaimSearch;
  me?: string;
}) => (
  <Table
    label="Claims"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Claim', sort: 'number' },
      ...(showPatient ? [{ label: 'Patient', sort: 'patient' }] : []),
      { label: 'Encounter', isSecondary: true, sort: 'encounter' },
      { label: 'Service Date', sort: 'service' },
      { label: 'Total', sort: 'total' },
      { label: 'Balance', sort: 'balance' },
      { label: 'Payers', isSecondary: true },
      { label: 'Status', sort: 'status' },
      { label: 'Waiting On', sort: 'waiting' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {claims.map((c) => (
      <TableRow key={c.id}>
        <TableCell>
          <span className="font-medium">
            <NumberHighlight number={c.number} query={search?.number ?? ''} />
          </span>
        </TableCell>
        {showPatient ? (
          <TableCell>
            {c.last_name !== null && c.patient_number !== null ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  <Highlight
                    text={c.last_name}
                    query={search?.lastName ?? ''}
                    isPrefix
                    keyOf={nameKey}
                  />
                  , <Highlight text={c.first_name ?? ''} query={search?.firstName ?? ''} isPrefix />
                </span>
                <span className="text-surface-fg-muted text-xs">
                  Patient <NumberHighlight number={c.patient_number} query={search?.number ?? ''} />
                </span>
              </span>
            ) : (
              <span className="text-surface-fg-muted">Not matched yet</span>
            )}
          </TableCell>
        ) : null}
        <TableCell isSecondary>
          {c.encounter_number || c.pcr_number ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {c.encounter_number ? (
                  <NumberHighlight number={c.encounter_number} query={search?.number ?? ''} />
                ) : (
                  emptyValue
                )}
              </span>
              {c.pcr_number ? (
                <span className="text-surface-fg-muted text-xs">
                  PCR{' '}
                  <Highlight
                    text={c.pcr_number}
                    query={search?.number.trim() === c.pcr_number ? c.pcr_number : ''}
                  />
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-surface-fg-muted">{emptyValue}</span>
          )}
        </TableCell>
        <TableCell kind="date">{formatDate(c.service_date)}</TableCell>
        <TableCell kind="numeric">{formatCents(c.total_cents)}</TableCell>
        <TableCell kind="numeric">
          <span className="font-semibold">{formatCents(c.balance_cents)}</span>
        </TableCell>
        <TableCell kind="wrap" isMuted={!c.payers.length} isSecondary>
          {c.payers.length ? c.payers.join(' → ') : 'Patient only'}
        </TableCell>
        <TableCell>
          <ClaimStatusBadge status={c.status} />
        </TableCell>
        <TableCell kind="wrap">
          <WaitingOn claim={c} me={me} />
        </TableCell>
        <TableCell kind="actions">
          <RowActions>
            <OpenLink to={withBack(`/claims/${c.id}`, back)} name={`claim ${c.number}`} />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

const isSearching = (s: ClaimSearch) =>
  Boolean(s.firstName || s.lastName || s.birthDate || s.number);

const ClaimResults = ({
  client,
  live,
  query,
  table,
  me,
  search,
  empty
}: {
  client: ClaimsClient;
  live: Live;
  query: Parameters<ClaimsClient['list']>[0];
  table: TableState<keyof typeof CLAIM_TABLE.sorts>;
  me: string;
  search?: ClaimSearch;
  empty: ReactNode;
}) => {
  const key = Object.values(query).join('|');
  const claims = useResource(
    `claims:${key}:${table.apiQuery}`,
    (signal) => client.list(query, table.apiQuery, signal),
    30_000
  );
  const items = claims.data?.items ?? [];
  useLive(
    live,
    (e) =>
      (e.kind === 'claim' &&
        isOnPage(
          e.id,
          table.page,
          items.map((c) => c.id)
        )) ||
      (e.kind === 'task' &&
        isOnPage(
          e.id,
          table.page,
          items.map((c) => c.task_id)
        )),
    claims.reload,
    LIST_RELOAD_MS
  );
  return (
    <>
      {claims.error ? <Alert>{claims.error.message}</Alert> : null}
      {items.length && claims.data ? (
        <>
          <ClaimsTable
            claims={items}
            sorting={table}
            back={table.href}
            me={me}
            {...(search ? { search } : {})}
          />
          <Pagination label="Claims" total={claims.data.total} state={table} />
        </>
      ) : claims.loading ? (
        <PageLoading />
      ) : claims.error ? null : (
        empty
      )}
    </>
  );
};

export const ClaimsPage = ({ client, live, me, search }: ClaimsPageProps) => {
  const table = useTableState(PATH, CLAIM_TABLE);
  return (
    <Page
      title="Claims"
      description="Find any claim, open or closed, by patient name, birth date or number."
    >
      <SearchForm label="Search claims" path={PATH} fields={CLAIM_SEARCH_FIELDS} />
      {isSearching(search) ? (
        <ClaimResults
          client={client}
          live={live}
          me={me}
          query={{ status: 'all', ...search }}
          table={table}
          search={search}
          empty={
            <EmptyState reason="noMatches" title="No Matching Claims">
              Names match from the start, so “Sm” finds Smith. Try fewer letters or another number.
            </EmptyState>
          }
        />
      ) : (
        <EmptyText>
          Enter a name, birth date, or a claim, patient or encounter number. Names match from the
          start.
        </EmptyText>
      )}
    </Page>
  );
};
