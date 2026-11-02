import { ChevronRightIcon } from 'lucide-react';
import { formatCents, formatDate } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { EmptyState, emptyValue } from '../../shared/ui/empty-state.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { PatientSearch, PatientSummary, PatientsClient } from './client.ts';

export type PatientsPageProps = {
  client: PatientsClient;
  search: PatientSearch;
};

const PATH = '/patients';

export const PATIENT_TABLE = {
  sorts: { name: 'asc', born: 'asc', lastService: 'desc', balance: 'desc' },
  sort: 'name'
} as const;

export const SEARCH_FIELDS: readonly SearchField[] = [
  { name: 'lastName', label: 'Last name' },
  { name: 'firstName', label: 'First name' },
  { name: 'birthDate', label: 'Birth date', type: 'date' }
];

export const placeOf = (p: Pick<PatientSummary, 'city' | 'state'>) =>
  [p.city, p.state].filter(Boolean).join(', ') || null;

export const PatientsTable = ({
  patients,
  sorting
}: {
  patients: readonly PatientSummary[];
  sorting?: TableSorting;
}) => (
  <Table
    label="Patients"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Patient', sort: 'name' },
      { label: 'Birth Date', sort: 'born' },
      { label: 'City', isSecondary: true },
      { label: 'Claims', isNumeric: true },
      { label: 'Open Balance', isNumeric: true, sort: 'balance' },
      { label: 'Last Service', isSecondary: true, sort: 'lastService' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {patients.map((p) => (
      <TableRow key={p.id}>
        <TableCell>
          <span className="font-medium">
            {p.last_name}, {p.first_name}
          </span>
        </TableCell>
        <TableCell kind="date">{formatDate(p.birth_date)}</TableCell>
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
          <IconLink
            to={`/patients/${p.id}`}
            label={`Open patient ${p.last_name}, ${p.first_name}`}
            icon={ChevronRightIcon}
          />
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const PatientsPage = ({ client, search }: PatientsPageProps) => {
  const table = useTableState(PATH, PATIENT_TABLE);
  const key = `${search.lastName}|${search.firstName}|${search.birthDate}`;
  const patients = useResource(`patients:${key}:${table.apiQuery}`, () =>
    client.list(search, table.apiQuery)
  );
  const searching = Boolean(search.lastName || search.firstName || search.birthDate);
  return (
    <Page
      title="Patients"
      description="Find a patient by name or birth date to see their claims and what they owe."
    >
      <SearchForm label="Search patients" path={PATH} fields={SEARCH_FIELDS} />
      {patients.error ? (
        <Alert>{patients.error.message}</Alert>
      ) : patients.data?.items.length ? (
        <>
          <PatientsTable patients={patients.data.items} sorting={table} />
          <Pagination label="Patients" total={patients.data.total} state={table} />
        </>
      ) : patients.loading ? (
        <PageLoading />
      ) : searching ? (
        <EmptyState reason="noMatches" title="No Matching Patients">
          Names match from the start, so “Sm” finds Smith. Try fewer letters or drop the birth date.
        </EmptyState>
      ) : (
        <EmptyState title="No Patients Yet">Patients are added as PCRs are imported.</EmptyState>
      )}
    </Page>
  );
};
