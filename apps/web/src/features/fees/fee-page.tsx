import { SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { parseDollars } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { DeleteDialog } from '../../shared/ui/dialog.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { DirectoryPayer, Fee, FeeInput, FeesClient } from './client.ts';
import { feeDeleteNote, feeName } from './fees-page.tsx';

type FeeDraft = { payerId: string; code: string; amount: string };

const DEFAULT_SCHEDULE = { value: '', label: 'Default Schedule (Every Payer)' };

type FindPayers = (q: string, signal: AbortSignal) => Promise<DirectoryPayer[]>;

export const payerOptions = (found: readonly DirectoryPayer[], chosen: DirectoryPayer | null) => [
  DEFAULT_SCHEDULE,
  ...[...(chosen && !found.some((p) => p.id === chosen.id) ? [chosen] : []), ...found].map((p) => ({
    value: p.id,
    label: p.name
  }))
];

const SEARCH_DELAY_MS = 250;

const PayerPicker = ({
  findPayers,
  value,
  onChange
}: {
  findPayers: FindPayers;
  value: DirectoryPayer | null;
  onChange: (payer: DirectoryPayer | null) => void;
}) => {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const found = useResource(`fee-payers:${q}`, (signal) => findPayers(q, signal));
  const payers = found.data ?? [];
  return (
    <>
      <Input
        id="fee-payer-search"
        label="Find Payer"
        type="search"
        span={2}
        placeholder="Type part of a payer name"
        hint={found.error ? found.error.message : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Select
        id="fee-payer"
        label="Payer"
        span={2}
        hint={payers.length === 50 ? 'Showing the first 50 matches.' : undefined}
        options={payerOptions(payers, value)}
        value={value?.id ?? ''}
        onChange={(e) =>
          onChange([value, ...payers].find((p) => p !== null && p.id === e.target.value) ?? null)
        }
      />
    </>
  );
};

export const toFeeDraft = (f: Fee | null): FeeDraft => ({
  payerId: f?.payer_id ?? '',
  code: f?.code ?? '',
  amount: f ? (f.amount_cents / 100).toFixed(2) : ''
});

export const toFeeInput = (draft: FeeDraft): FeeInput | string => {
  const code = draft.code.trim().toUpperCase();
  if (!code) return 'Enter a HCPCS code.';
  const amountCents = parseDollars(draft.amount);
  if (amountCents === null) return 'Enter an amount of zero or more.';
  return { payerId: draft.payerId || null, code, amountCents };
};

export const FeeForm = ({
  fee,
  findPayers,
  back,
  onSave
}: {
  fee: Fee | null;
  findPayers: FindPayers;
  back: string;
  onSave: (fee: FeeInput) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toFeeDraft(fee));
  const [payer, setPayer] = useState<DirectoryPayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = (key: keyof FeeDraft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value })
  });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = toFeeInput(draft);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setBusy(true);
    setError('');
    const failure = await onSave(input);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <form onSubmit={submit} aria-label="Save fee">
      <SectionPanel
        title="Fee"
        description={
          fee
            ? 'A fee is one price for one code and schedule; to price another code or payer, add a fee.'
            : 'Set a default price for a code, or a price for one payer.'
        }
      >
        <fieldset disabled={busy}>
          <FieldGrid>
            {fee ? (
              <Input
                id="fee-payer"
                label="Payer"
                span={4}
                readOnly
                value={fee.payer ?? DEFAULT_SCHEDULE.label}
              />
            ) : (
              <PayerPicker
                findPayers={findPayers}
                value={payer}
                onChange={(next) => {
                  setPayer(next);
                  setDraft({ ...draft, payerId: next?.id ?? '' });
                }}
              />
            )}
            <Input
              id="fee-code"
              label="HCPCS"
              placeholder="A0427"
              required
              isMonospace
              readOnly={fee !== null}
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
          </FieldGrid>
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <ButtonLink to={back} variant="outline">
            <XIcon aria-hidden="true" className="size-4" />
            Cancel
          </ButtonLink>
          <Button type="submit" isPending={busy}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Fee
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

type FeePageProps = {
  client: FeesClient;
  live: Live;
  feeId: string | null;
  back: string;
};

export const FeePage = ({ client, live, feeId, back }: FeePageProps) => {
  const fee = useResource(`fee:${feeId ?? 'new'}`, async (signal) =>
    feeId ? client.fee(feeId, signal) : null
  );
  useReconnect(live, fee.reload);
  const [deleting, setDeleting] = useState(false);
  const notify = useToast();
  if (fee.error) return <PageFailure message={fee.error.message} />;
  const current = fee.data ?? null;
  const save = async (input: FeeInput) => {
    try {
      const saved = await client.save(input);
      notify({ title: `${feeName(saved)} ${current ? 'updated' : 'added'}` });
      navigate(back);
      return null;
    } catch (err) {
      return messageOf(err);
    }
  };
  const remove = async (f: Fee) => {
    try {
      await client.remove(f.id);
      notify({ title: `${feeName(f)} deleted` });
      navigate(back);
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete fee', description: messageOf(err) });
    }
  };
  return (
    <Page
      title={feeId ? (current ? feeName(current) : 'Fee') : 'Add Fee'}
      description={
        current
          ? `The price claims use for ${current.code} on ${current.payer ? `${current.payer} claims` : 'the default schedule'}.`
          : 'A price for an ambulance HCPCS code, for every payer or just one.'
      }
      backTo={back}
      backLabel="Back to Fees"
      actions={
        current ? (
          <Button intent="danger" variant="outline" onClick={() => setDeleting(true)}>
            <Trash2Icon aria-hidden="true" className="size-4" />
            Delete Fee
          </Button>
        ) : null
      }
    >
      {feeId && fee.data === undefined ? (
        <PageLoading />
      ) : (
        <FeeForm
          key={current?.id ?? 'new'}
          fee={current}
          findPayers={client.payers}
          back={back}
          onSave={save}
        />
      )}
      <DeleteDialog
        open={deleting}
        name={current ? feeName(current) : ''}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          if (current) void remove(current);
        }}
      >
        {current ? feeDeleteNote(current) : null}
      </DeleteDialog>
    </Page>
  );
};
