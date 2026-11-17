import { PlusIcon } from 'lucide-react';
import { useCan } from '../../shared/access.tsx';
import { formatCents, formatDate } from '../../shared/format.ts';
import { LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { Badge } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { Search } from '../../shared/ui/search.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, useSearchState, withBack } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Deposit, DepositsClient } from './client.ts';

export const DEPOSITS_PATH = '/deposits';

const DEPOSIT_TABLE = {
  sorts: { deposited: 'desc', amount: 'desc', trace: 'asc' },
  sort: 'deposited'
} as const;

export const DepositsTable = ({
  deposits,
  search
}: {
  deposits: readonly Deposit[];
  search: SearchView;
}) => (
  <Table
    label="Deposits"
    sorting={search}
    head={[
      { label: 'Trace Number', sort: 'trace' },
      { label: 'Payer' },
      { label: 'Deposited', sort: 'deposited' },
      { label: 'Amount', sort: 'amount' },
      { label: 'Remittance' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {deposits.map((d) => (
      <TableRow key={d.id}>
        <TableCell>
          <span className="font-medium tabular-nums">
            <Highlight text={d.trace_number} query={search.q} />
          </span>
        </TableCell>
        <TableCell isMuted={!d.payer_name}>
          {d.payer_name ? <Highlight text={d.payer_name} query={search.q} /> : emptyValue}
        </TableCell>
        <TableCell kind="date">{formatDate(d.deposited_on)}</TableCell>
        <TableCell kind="numeric">{formatCents(d.amount_cents)}</TableCell>
        <TableCell>
          {d.payer_file_id ? d.file_name : <Badge intent="warning">Unmatched</Badge>}
        </TableCell>
        <TableCell kind="actions">
          <OpenLink
            to={withBack(`${DEPOSITS_PATH}/${d.id}`, search.href)}
            name={`deposit ${d.trace_number}`}
          />
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const DepositsPage = ({ client, live }: { client: DepositsClient; live: Live }) => {
  const can = useCan();
  const search = useSearchState(DEPOSITS_PATH, DEPOSIT_TABLE);
  const deposits = useResource(`deposits:${search.apiQuery}`, (signal) =>
    client.search(search.apiQuery, signal)
  );
  useLive(live, (e) => e.kind === 'payerFile', deposits.reload, LIST_RELOAD_MS);
  const add = withBack(`${DEPOSITS_PATH}/new`, search.href);
  const recordButton = (variant?: 'outline') =>
    can('payer_files:create') ? (
      <ButtonLink to={add} variant={variant}>
        <PlusIcon aria-hidden="true" className="size-4" />
        Record Deposit
      </ButtonLink>
    ) : undefined;
  return (
    <Page
      title="Deposits"
      description="Bank deposits, matched to their 835 remittances by EFT trace number."
      actions={recordButton()}
    >
      <Search
        label="Deposits"
        path={DEPOSITS_PATH}
        search={search}
        results={deposits}
        empty={{
          title: 'No Deposits Yet',
          children: 'Record each payer deposit from your bank statement to reconcile it.',
          action: recordButton('outline')
        }}
      >
        {(items) => <DepositsTable deposits={items} search={search} />}
      </Search>
    </Page>
  );
};
