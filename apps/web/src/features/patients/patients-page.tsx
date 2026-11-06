import { nameKey } from '@ugula/billing';
import { formatCents, formatDate } from '../../shared/format.ts';
import { LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { DateHighlight, Highlight, NumberHighlight } from '../../shared/ui/highlight.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useTableState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { PatientSearch, PatientSummary, PatientsClient } from './client.ts';

type PatientsPageProps = {
  client: PatientsClient;
  live: Live;
  search: PatientSearch;
};

const PATH = '/patients';

const PATIENT_TABLE = {
  sorts: {
    name: 'asc',
    number: 'desc',
    born: 'asc',
    lastService: 'desc',
    balance: 'desc',
    city: 'asc',
    claims: 'desc'
  },
  sort: 'name'
} as const;

const SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'lastName', label: 'Last Name' },
  { name: 'firstName', label: 'First Name' },
  { name: 'birthDate', label: 'Birth Date', type: 'date' },
  { name: 'number', label: 'Patient Number', placeholder: '20261105-0001' }
];

export const placeOf = (p: Pick<PatientSummary, 'city' | 'state'>) =>
  [p.city, p.state].filter(Boolean).join(', ') || null;

export const PatientsTable = ({
  patients,
  sorting,
  back = '',
  search
}: {
  patients: readonly PatientSummary[];
  sorting?: TableSorting;
  back?: string;
  search?: PatientSearch;
}) => (
  <Table
    label="Patients"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Patient', sort: 'name' },
      { label: 'Number', sort: 'number' },
      { label: 'Birth Date', sort: 'born' },
      { label: 'City', isSecondary: true, sort: 'city' },
      { label: 'Claims', sort: 'claims' },
      { label: 'Open Balance', sort: 'balance' },
      { label: 'Last Service', isSecondary: true, sort: 'lastService' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {patients.map((p) => (
      <TableRow key={p.id}>
        <TableCell>
          <span className="font-medium">
            <Highlight text={p.last_name} query={search?.lastName ?? ''} isPrefix keyOf={nameKey} />
            , <Highlight text={p.first_name} query={search?.firstName ?? ''} isPrefix />
          </span>
        </TableCell>
        <TableCell>
          <span className="tabular-nums">
            <NumberHighlight number={p.number} query={search?.number ?? ''} />
          </span>
        </TableCell>
        <TableCell kind="date">
          <DateHighlight day={p.birth_date} query={search?.birthDate ?? ''} />
        </TableCell>
        <TableCell isMuted isSecondary>
          {placeOf(p) ?? emptyValue}
        </TableCell>
        <TableCell kind="numeric">{p.claim_count}</TableCell>
        <TableCell kind="numeric">
          <span className={p.balance_cents ? 'font-semibold' : 'text-surface-fg-muted'}>
            {formatCents(p.balance_cents)}
          </span>
        </TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDate(p.last_service_date)}
        </TableCell>
        <TableCell kind="actions">
          <OpenLink
            to={withBack(`/patients/${p.id}`, back)}
            name={`patient ${p.last_name}, ${p.first_name}`}
          />
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

const isSearching = (s: PatientSearch) =>
  Boolean(s.lastName.trim() || s.firstName.trim() || s.birthDate.trim() || s.number.trim());

const PatientResults = ({ client, live, search }: PatientsPageProps) => {
  const table = useTableState(PATH, PATIENT_TABLE);
  const key = `${search.lastName}|${search.firstName}|${search.birthDate}|${search.number}`;
  const patients = useResource(`patients:${key}:${table.apiQuery}`, (signal) =>
    client.list(search, table.apiQuery, signal)
  );
  useLive(live, (e) => e.kind === 'claim', patients.reload, LIST_RELOAD_MS);
  return patients.error ? (
    <Alert>{patients.error.message}</Alert>
  ) : patients.data?.items.length ? (
    <>
      <PatientsTable
        patients={patients.data.items}
        sorting={table}
        back={table.href}
        search={search}
      />
      <Pagination label="Patients" total={patients.data.total} state={table} />
    </>
  ) : patients.loading ? (
    <PageLoading />
  ) : (
    <EmptyState reason="noMatches" title="No Matching Patients">
      Names match from the start, so “Sm” finds Smith. Try fewer letters, or drop the birth date or
      number.
    </EmptyState>
  );
};

export const PatientsPage = ({ client, live, search }: PatientsPageProps) => (
  <Page title="Patients">
    <SearchForm label="Search patients" path={PATH} fields={SEARCH_FIELDS} />
    {isSearching(search) ? (
      <PatientResults client={client} live={live} search={search} />
    ) : (
      <EmptyText>
        Enter a last name, first name, birth date or patient number. Names match from the start.
      </EmptyText>
    )}
  </Page>
);
