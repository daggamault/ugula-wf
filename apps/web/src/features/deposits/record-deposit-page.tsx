import { deepEqual } from '@ugula/graph';
import { SaveIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { parseDollars } from '../../shared/format.ts';
import { navigate, useUnsavedChanges } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import type { DepositInput, DepositsClient } from './client.ts';
import { DEPOSITS_PATH } from './deposits-page.tsx';

type DepositDraft = {
  traceNumber: string;
  amount: string;
  depositedOn: string;
  payerName: string;
  note: string;
};

const BLANK: DepositDraft = {
  traceNumber: '',
  amount: '',
  depositedOn: '',
  payerName: '',
  note: ''
};

export const toDepositInput = (draft: DepositDraft): DepositInput | string => {
  const traceNumber = draft.traceNumber.trim();
  if (!traceNumber) return 'Enter the trace number.';
  const amountCents = parseDollars(draft.amount);
  if (amountCents === null || amountCents === 0) return 'Enter an amount greater than zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.depositedOn)) return 'Enter the day it was deposited.';
  return {
    traceNumber,
    amountCents,
    depositedOn: draft.depositedOn,
    payerName: draft.payerName.trim() || null,
    note: draft.note.trim() || null
  };
};

export const RecordDepositPage = ({ client, back }: { client: DepositsClient; back: string }) => {
  const [draft, setDraft] = useState(BLANK);
  useUnsavedChanges(!deepEqual(draft, BLANK));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();
  const field = (key: keyof DepositDraft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value })
  });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = toDepositInput(draft);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { id } = await client.record(input);
      notify({ title: `Deposit ${input.traceNumber} recorded` });
      navigate(`${DEPOSITS_PATH}/${id}`, { force: true });
    } catch (err) {
      setBusy(false);
      setError(messageOf(err));
    }
  };
  return (
    <Page title="Record Deposit" backTo={back} backLabel="Back to Deposits">
      <form onSubmit={submit} aria-label="Record deposit">
        <SectionPanel title="Deposit">
          <fieldset disabled={busy}>
            <FieldGrid>
              <Input
                id="deposit-trace"
                label="Trace Number"
                hint="The EFT trace or check number on the bank statement"
                span={2}
                required
                maxLength={50}
                isMonospace
                {...field('traceNumber')}
              />
              <Input
                id="deposit-amount"
                label="Amount (USD)"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                required
                {...field('amount')}
              />
              <Input
                id="deposit-on"
                label="Deposited On"
                type="date"
                required
                {...field('depositedOn')}
              />
              <Input id="deposit-payer" label="Payer" span={2} {...field('payerName')} />
              <Textarea
                id="deposit-note"
                label="Note"
                span={4}
                maxLength={500}
                {...field('note')}
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
              Record Deposit
            </Button>
          </FormActions>
        </SectionPanel>
      </form>
    </Page>
  );
};
