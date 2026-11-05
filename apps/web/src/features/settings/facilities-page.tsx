import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { DeleteDialog } from '../../shared/ui/dialog.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { DeleteButton, EditLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Facility, SettingsClient } from './client.ts';

export const FACILITIES_PATH = '/facilities';

export const FACILITY_TABLE = { sorts: { name: 'asc', city: 'asc' }, sort: 'name' } as const;

export const facilityDeleteNote = (name: string) =>
  `Claims ${name} is responsible for go back to their payers and the patient.`;

export const placeOf = (f: Pick<Facility, 'address_line' | 'city' | 'state'>) =>
  [f.address_line, [f.city, f.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

export const FacilitiesTable = ({
  facilities,
  search,
  onDelete
}: {
  facilities: readonly Facility[];
  search: SearchView;
  onDelete: (facility: Facility) => void;
}) => (
  <Table
    label="Facilities"
    sorting={search}
    head={[
      { label: 'Facility', sort: 'name' },
      { label: 'Address', isSecondary: true, sort: 'city' },
      'Owed',
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {facilities.map((f) => (
      <TableRow key={f.id}>
        <TableCell kind="wrap">
          <span className="font-medium">
            <Highlight text={f.name} query={search.q} />
          </span>
        </TableCell>
        <TableCell isMuted isSecondary>
          {placeOf(f)}
        </TableCell>
        <TableCell kind="numeric">{formatCents(f.balance_cents)}</TableCell>
        <TableCell kind="actions">
          <RowActions>
            <EditLink to={withBack(`${FACILITIES_PATH}/${f.id}`, search.href)} name={f.name} />
            <DeleteButton name={f.name} onClick={() => onDelete(f)} />
          </RowActions>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const FacilitiesPage = ({ client, live }: { client: SettingsClient; live: Live }) => {
  const search = useSearchState(FACILITIES_PATH, FACILITY_TABLE);
  const facilities = useResource(`facilities:${search.apiQuery}`, (signal) =>
    client.searchFacilities(search.apiQuery, signal)
  );
  useReconnect(live, facilities.reload);
  const [deleting, setDeleting] = useState<Facility | null>(null);
  const notify = useToast();
  const remove = async (f: Facility) => {
    try {
      await client.removeFacility(f.id);
      notify({ title: `${f.name} deleted` });
      facilities.reload();
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete facility', description: messageOf(err) });
    }
  };
  const add = withBack(`${FACILITIES_PATH}/new`, search.href);
  return (
    <Page
      title="Facilities"
      description="Hospitals and nursing facilities that pay for trips they are responsible for, invoiced every month."
      actions={
        <ButtonLink to={add}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add Facility
        </ButtonLink>
      }
    >
      <Search
        label="Facilities"
        path={FACILITIES_PATH}
        search={search}
        results={facilities}
        empty={{
          title: 'No Facilities Yet',
          children: 'Add a facility to bill it for the trips it is responsible for.',
          action: (
            <ButtonLink to={add} variant="outline">
              <PlusIcon aria-hidden="true" className="size-4" />
              Add Facility
            </ButtonLink>
          )
        }}
      >
        {(items) => <FacilitiesTable facilities={items} search={search} onDelete={setDeleting} />}
      </Search>
      <DeleteDialog
        open={deleting !== null}
        name={deleting?.name ?? ''}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const facility = deleting;
          setDeleting(null);
          if (facility) void remove(facility);
        }}
      >
        {deleting ? facilityDeleteNote(deleting.name) : null}
      </DeleteDialog>
    </Page>
  );
};
