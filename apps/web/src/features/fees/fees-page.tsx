import { PencilIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatCents, formatDateTime, parseDollars } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { EmptyState } from '../../shared/ui/empty-state.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { pageOf, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { Fee, FeeInput, FeesClient } from './client.ts';

export type FeesPageProps = {
  client: FeesClient;
};

type Draft = { payerId: string; code: string; amount: string };

const EMPTY: Draft = { payerId: '', code: '', amount: '' };

const DEFAULT_SCHEDULE = { value: '', label: 'Default schedule (every payer)' };

export const toFeeInput = (draft: Draft): FeeInput | string => {
  const amountCents = parseDollars(draft.amount);
  if (amountCents === null) return 'Enter an amount of zero or more';
  return { payerId: draft.payerId || null, code: draft.code.trim().toUpperCase(), amountCents };
};

const feeName = (f: Fee) => `${f.payer ?? 'Default'} ${f.code}`;

export const FEE_TABLE = {
  sorts: { payer: 'asc', code: 'asc', amount: 'desc', updated: 'desc' },
  sort: 'payer'
} as const;

export const FEE_VALUES = {
  payer: (f: Fee) => `${f.payer === null ? 0 : 1} ${f.payer ?? ''} ${f.code}`,
  code: (f: Fee) => f.code,
  amount: (f: Fee) => f.amount_cents,
  updated: (f: Fee) => f.updated_at
};

export const FeesTable = ({
  fees,
  sorting,
  onEdit,
  onDelete
}: {
  fees: readonly Fee[];
  sorting?: TableSorting;
  onEdit: (fee: Fee) => void;
  onDelete: (fee: Fee) => void;
}) => (
  <Table
    label="Fee schedule"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'Payer', sort: 'payer' },
      { label: 'HCPCS', sort: 'code' },
      { label: 'Amount', isNumeric: true, sort: 'amount' },
      { label: 'Updated', isSecondary: true, sort: 'updated' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {fees.map((f) => (
      <TableRow key={f.id}>
        <TableCell>
          {f.payer ? <span className="font-medium">{f.payer}</span> : <Badge>Default</Badge>}
        </TableCell>
        <TableCell>
          <span className="font-mono font-semibold">{f.code}</span>
        </TableCell>
        <TableCell kind="numeric">{formatCents(f.amount_cents)}</TableCell>
        <TableCell kind="date" isMuted isSecondary>
          {formatDateTime(f.updated_at)}
        </TableCell>
        <TableCell kind="actions">
          <span className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={`Edit ${feeName(f)}`}
              onClick={() => onEdit(f)}
            >
              <PencilIcon aria-hidden="true" className="size-4" />
              Edit
            </Button>
            <Button
              intent="danger"
              variant="outline"
              size="sm"
              aria-label={`Delete ${feeName(f)}`}
              onClick={() => onDelete(f)}
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Delete
            </Button>
          </span>
        </TableCell>
      </TableRow>
    ))}
  </Table>
);

export const FeesPage = ({ client }: FeesPageProps) => {
  const fees = useResource('fees', client.list);
  const table = useTableState('/fees', FEE_TABLE);
  const payers = useResource('fee-payers', client.payers);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const payerOptions = [
    DEFAULT_SCHEDULE,
    ...(payers.data ?? []).map((p) => ({ value: p.id, label: p.name }))
  ];
  const payerLabel = payerOptions.find((o) => o.value === draft.payerId)?.label ?? '';
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<Fee | null>(null);
  const reset = () => {
    setDraft(EMPTY);
    setEditing(false);
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const notify = useToast();
  const act = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      fees.reload();
      notify({ title: done });
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = toFeeInput(draft);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    if (await act(() => client.save(input), editing ? 'Fee updated' : 'Fee added')) reset();
  };

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value })
  });

  return (
    <Page
      title="Fees"
      description="Prices for ambulance HCPCS codes. A claim is priced with its primary payer's price when the payer directory has one, otherwise the default."
    >
      <SectionPanel
        title={editing ? 'Edit Fee' : 'Add a Fee'}
        description={
          editing
            ? `Change the price of ${draft.code} for ${draft.payerId ? payerLabel : 'the default schedule'}.`
            : 'Set a default price for a code, or a price for one payer in the directory.'
        }
        accent={editing ? 'primary' : undefined}
      >
        <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Save fee">
          <fieldset
            disabled={busy}
            className="grid gap-x-4 gap-y-5 sm:grid-cols-[minmax(0,1fr)_9rem_10rem]"
          >
            <Select
              id="fee-payer"
              label="Payer"
              options={payerOptions}
              disabled={editing}
              {...field('payerId')}
            />
            <Input
              id="fee-code"
              label="HCPCS"
              placeholder="A0427"
              required
              isMonospace
              readOnly={editing}
              {...field('code')}
            />
            <Input
              id="fee-amount"
              label="Amount (USD)"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              required
              {...field('amount')}
            />
          </fieldset>
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" isPending={busy}>
              <SaveIcon aria-hidden="true" className="size-4" />
              {editing ? 'Update fee' : 'Save fee'}
            </Button>
            {editing ? (
              <Button variant="outline" onClick={reset}>
                <XIcon aria-hidden="true" className="size-4" />
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </SectionPanel>
      {fees.error ? <Alert>{fees.error.message}</Alert> : null}
      {fees.data?.length ? (
        <>
          <FeesTable
            fees={pageOf(fees.data, table, FEE_VALUES).items}
            sorting={table}
            onEdit={(f) => {
              setEditing(true);
              setDraft({
                payerId: f.payer_id ?? '',
                code: f.code,
                amount: (f.amount_cents / 100).toFixed(2)
              });
            }}
            onDelete={setDeleting}
          />
          <Pagination label="Fees" total={fees.data.length} state={table} />
        </>
      ) : fees.data ? (
        <EmptyState title="No Fees">
          Claims cannot be priced until each code has a fee. Add one above.
        </EmptyState>
      ) : (
        <PageLoading />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Fee?"
        intent="danger"
        confirmLabel="Delete"
        confirmIcon={Trash2Icon}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const fee = deleting;
          setDeleting(null);
          if (fee) void act(() => client.remove(fee.id), 'Fee deleted');
        }}
      >
        {deleting
          ? `Claims will no longer be priced with ${formatCents(deleting.amount_cents)} for ${feeName(deleting)}.`
          : null}
      </ConfirmDialog>
    </Page>
  );
};
