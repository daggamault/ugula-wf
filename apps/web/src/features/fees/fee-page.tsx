import { SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { parseDollars } from '../../shared/format.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { DeleteDialog } from '../../shared/ui/dialog.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select, type SelectOption } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { Fee, FeeInput, FeesClient } from './client.ts';
import { feeDeleteNote, feeName } from './fees-page.tsx';

export type FeeDraft = { payerId: string; code: string; amount: string };

export const DEFAULT_SCHEDULE = { value: '', label: 'Default Schedule (Every Payer)' };

export const toFeeDraft = (f: Fee | null): FeeDraft => ({
  payerId: f?.payer_id ?? '',
  code: f?.code ?? '',
  amount: f ? (f.amount_cents / 100).toFixed(2) : ''
});

export const toFeeInput = (draft: FeeDraft): FeeInput | string => {
  const amountCents = parseDollars(draft.amount);
  if (amountCents === null) return 'Enter an amount of zero or more.';
  return { payerId: draft.payerId || null, code: draft.code.trim().toUpperCase(), amountCents };
};

export const FeeForm = ({
  fee,
  payers,
  back,
  onSave
}: {
  fee: Fee | null;
  payers: readonly SelectOption[];
  back: string;
  onSave: (fee: FeeInput) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toFeeDraft(fee));
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
            <Select
              id="fee-payer"
              label="Payer"
              span={2}
              options={[DEFAULT_SCHEDULE, ...payers]}
              disabled={fee !== null}
              {...field('payerId')}
            />
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

export type FeePageProps = {
  client: FeesClient;
  feeId: string | null;
  back: string;
};

export const FeePage = ({ client, feeId, back }: FeePageProps) => {
  const fee = useResource(`fee:${feeId ?? 'new'}`, async () => (feeId ? client.fee(feeId) : null));
  const payers = useResource('fee-payers', client.payers);
  const [deleting, setDeleting] = useState(false);
  const notify = useToast();
  const failure = fee.error ?? payers.error;
  if (failure) return <PageFailure message={failure.message} />;
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
          : 'Prices for ambulance HCPCS codes. A claim uses its primary payer’s price when there is one, otherwise the default.'
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
      {(feeId && fee.data === undefined) || !payers.data ? (
        <PageLoading />
      ) : (
        <FeeForm
          key={current?.id ?? 'new'}
          fee={current}
          payers={payers.data.map((p) => ({ value: p.id, label: p.name }))}
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
