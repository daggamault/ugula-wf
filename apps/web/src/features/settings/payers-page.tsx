import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
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
import type { Payer, SettingsClient } from './client.ts';
import { FILING_OPTIONS } from './settings-page.tsx';

export const PAYERS_PATH = '/payers';

export const PAYER_TABLE = {
  sorts: { name: 'asc', payerId: 'asc', filing: 'asc' },
  sort: 'name'
} as const;

export const filingLabel = (code: string) =>
  FILING_OPTIONS.find((o) => o.value === code)?.label ?? code;

export const payerDeleteNote = (name: string) =>
  `Its prices are removed, and claims billed to ${name} cannot go in an 837P file until it is added again.`;

export const LearnedNames = ({ payer, q = '' }: { payer: Payer; q?: string }) =>
  payer.aliases.length ? (
    <ul aria-label={`Learned names for ${payer.name}`} className="flex flex-wrap gap-1">
      {payer.aliases.map((a) => (
        <li key={a.id}>
          <Badge>
            <Highlight text={a.alias} query={q} />
          </Badge>
        </li>
      ))}
    </ul>
  ) : null;

export const PayersTable = ({
  payers,
  search,
  onDelete
}: {
  payers: readonly Payer[];
  search: SearchView;
  onDelete: (payer: Payer) => void;
}) => (
  <Table
    label="Payers"
    sorting={search}
    head={[
      { label: 'Payer', sort: 'name' },
      { label: 'Clearinghouse Payer ID', sort: 'payerId' },
      { label: 'Claim Filing', isSecondary: true, sort: 'filing' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {payers.map((p) => {
      const edit = withBack(`${PAYERS_PATH}/${p.id}`, search.href);
      return (
        <TableRow key={p.id}>
          <TableCell kind="wrap">
            <span className="flex flex-col gap-1">
              <span className="font-medium">
                <Highlight text={p.name} query={search.q} />
              </span>
              <LearnedNames payer={p} q={search.q} />
            </span>
          </TableCell>
          <TableCell>
            <span className="font-mono">
              <Highlight text={p.payer_id} query={search.q} />
            </span>
          </TableCell>
          <TableCell isMuted isSecondary>
            {filingLabel(p.claim_filing)}
          </TableCell>
          <TableCell kind="actions">
            <RowActions>
              <EditLink to={edit} name={p.name} />
              <DeleteButton name={p.name} onClick={() => onDelete(p)} />
            </RowActions>
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

export const PayersPage = ({ client, live }: { client: SettingsClient; live: Live }) => {
  const search = useSearchState(PAYERS_PATH, PAYER_TABLE);
  const payers = useResource(`payers:${search.apiQuery}`, (signal) =>
    client.searchPayers(search.apiQuery, signal)
  );
  useReconnect(live, payers.reload);
  const [deleting, setDeleting] = useState<Payer | null>(null);
  const notify = useToast();
  const remove = async (p: Payer) => {
    try {
      await client.removePayer(p.id);
      notify({ title: `${p.name} deleted` });
      payers.reload();
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete payer', description: messageOf(err) });
    }
  };
  const add = withBack(`${PAYERS_PATH}/new`, search.href);
  return (
    <Page
      title="Payers"
      description="Clearinghouse payer IDs and filing codes for 837P claims, matched to the payer names on PCRs."
      actions={
        <ButtonLink to={add}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add Payer
        </ButtonLink>
      }
    >
      <Search
        label="Payers"
        path={PAYERS_PATH}
        search={search}
        results={payers}
        empty={{
          title: 'No Payers Yet',
          children: 'Claims cannot go in an 837P file until their payers are listed here.',
          action: (
            <ButtonLink to={add} variant="outline">
              <PlusIcon aria-hidden="true" className="size-4" />
              Add Payer
            </ButtonLink>
          )
        }}
      >
        {(items) => <PayersTable payers={items} search={search} onDelete={setDeleting} />}
      </Search>
      <DeleteDialog
        open={deleting !== null}
        name={deleting?.name ?? ''}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const payer = deleting;
          setDeleting(null);
          if (payer) void remove(payer);
        }}
      >
        {deleting ? payerDeleteNote(deleting.name) : null}
      </DeleteDialog>
    </Page>
  );
};
