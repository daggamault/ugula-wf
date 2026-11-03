import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents, formatDateTime } from '../../shared/format.ts';
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
import type { Fee, FeesClient } from './client.ts';

export const FEES_PATH = '/fees';

export const FEE_TABLE = {
  sorts: { payer: 'asc', code: 'asc', amount: 'desc', updated: 'desc' },
  sort: 'payer'
} as const;

export const feeName = (f: Pick<Fee, 'payer' | 'code'>) => `${f.payer ?? 'Default'} ${f.code}`;

export const feeDeleteNote = (f: Fee) =>
  `Claims will no longer be priced with ${formatCents(f.amount_cents)} for ${feeName(f)}.`;

export const FeesTable = ({
  fees,
  search,
  onDelete
}: {
  fees: readonly Fee[];
  search: SearchView;
  onDelete: (fee: Fee) => void;
}) => (
  <Table
    label="Fee schedule"
    sorting={search}
    head={[
      { label: 'Payer', sort: 'payer' },
      { label: 'HCPCS', sort: 'code' },
      { label: 'Amount', sort: 'amount' },
      { label: 'Updated', isSecondary: true, sort: 'updated' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {fees.map((f) => {
      const edit = withBack(`${FEES_PATH}/${f.id}`, search.href);
      return (
        <TableRow key={f.id}>
          <TableCell>
            {f.payer ? (
              <span className="font-medium">
                <Highlight text={f.payer} query={search.q} />
              </span>
            ) : (
              <Badge>
                <Highlight text="Default" query={search.q} />
              </Badge>
            )}
          </TableCell>
          <TableCell>
            <span className="font-mono font-semibold">
              <Highlight text={f.code} query={search.q} />
            </span>
          </TableCell>
          <TableCell kind="numeric">{formatCents(f.amount_cents)}</TableCell>
          <TableCell kind="date" isMuted isSecondary>
            {formatDateTime(f.updated_at)}
          </TableCell>
          <TableCell kind="actions">
            <RowActions>
              <EditLink to={edit} name={feeName(f)} />
              <DeleteButton name={feeName(f)} onClick={() => onDelete(f)} />
            </RowActions>
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

export const FeesPage = ({ client, live }: { client: FeesClient; live: Live }) => {
  const search = useSearchState(FEES_PATH, FEE_TABLE);
  const fees = useResource(`fees:${search.apiQuery}`, () => client.search(search.apiQuery));
  useReconnect(live, fees.reload);
  const [deleting, setDeleting] = useState<Fee | null>(null);
  const notify = useToast();
  const remove = async (fee: Fee) => {
    try {
      await client.remove(fee.id);
      notify({ title: `${feeName(fee)} deleted` });
      fees.reload();
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete fee', description: messageOf(err) });
    }
  };
  const add = withBack(`${FEES_PATH}/new`, search.href);
  return (
    <Page
      title="Fees"
      description="Prices for ambulance HCPCS codes. A claim uses its primary payer's price when there is one, otherwise the default."
      actions={
        <ButtonLink to={add}>
          <PlusIcon aria-hidden="true" className="size-4" />
          Add Fee
        </ButtonLink>
      }
    >
      <Search
        label="Fees"
        path={FEES_PATH}
        search={search}
        results={fees}
        empty={{
          title: 'No Fees Yet',
          children: 'Claims cannot be priced until each code has a fee.',
          action: (
            <ButtonLink to={add} variant="outline">
              <PlusIcon aria-hidden="true" className="size-4" />
              Add Fee
            </ButtonLink>
          )
        }}
      >
        {(items) => <FeesTable fees={items} search={search} onDelete={setDeleting} />}
      </Search>
      <DeleteDialog
        open={deleting !== null}
        name={deleting ? feeName(deleting) : ''}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const fee = deleting;
          setDeleting(null);
          if (fee) void remove(fee);
        }}
      >
        {deleting ? feeDeleteNote(deleting) : null}
      </DeleteDialog>
    </Page>
  );
};
