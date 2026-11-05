import { ADJUSTMENT_GROUPS, ADJUSTMENT_REASON_PATTERN, type AdjustmentGroup } from '@ugula/billing';
import { PlusIcon, SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { parseDollars } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid, FieldGroup, FormActions } from '../../shared/ui/field.tsx';
import { RemoveButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { ClaimCoverage, ClaimResponseInput } from './client.ts';

type ResponseKind = ClaimResponseInput['kind'];

type AdjustmentDraft = { id: string; group: AdjustmentGroup; reason: string; amount: string };

export type ResponseDraft = {
  kind: ResponseKind;
  coverageId: string;
  paid: string;
  adjusted: string;
  paidOn: string;
  checkNumber: string;
  payerClaimNumber: string;
  adjustments: AdjustmentDraft[];
  note: string;
};

const REASON = new RegExp(ADJUSTMENT_REASON_PATTERN);

const signedCents = (text: string) => {
  const amount = Number(text);
  return text.trim() !== '' && Number.isFinite(amount) && amount !== 0
    ? Math.round(amount * 100)
    : null;
};

const adjustmentOf = (a: AdjustmentDraft) => {
  const reason = a.reason.trim().toUpperCase();
  const cents = signedCents(a.amount);
  return REASON.test(reason) && cents !== null ? { group: a.group, reason, cents } : null;
};

const orNull = (text: string) => text.trim() || null;

export const toResponse = (
  draft: ResponseDraft
): Omit<ClaimResponseInput, 'requestId'> | string => {
  const isRefund = draft.kind === 'refunded';
  const paidCents = parseDollars(draft.paid || '0');
  const adjustedCents = isRefund ? 0 : parseDollars(draft.adjusted || '0');
  if (paidCents === null || adjustedCents === null) return 'Enter amounts of zero or more';
  if (isRefund && paidCents === 0) return 'A refund needs the amount paid back';
  if (paidCents + adjustedCents === 0 && draft.coverageId === '') {
    return 'A patient payment needs an amount';
  }
  const adjustments = isRefund ? [] : draft.adjustments.map(adjustmentOf);
  if (adjustments.some((a) => a === null)) {
    return 'Each reason code needs a code like 45 and an amount other than zero';
  }
  const coverageId = draft.coverageId || null;
  return {
    kind: draft.kind,
    coverageId,
    paidCents,
    adjustedCents,
    paidOn: orNull(draft.paidOn),
    checkNumber: orNull(draft.checkNumber),
    payerClaimNumber: coverageId && !isRefund ? orNull(draft.payerClaimNumber) : null,
    adjustments: adjustments.filter((a) => a !== null),
    note: draft.note.trim()
  };
};

const GROUP_OPTIONS = Object.entries(ADJUSTMENT_GROUPS).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

const KIND_OPTIONS = [
  { value: 'response', label: 'Payment' },
  { value: 'refunded', label: 'Refund' }
];

const isGroup = (x: string): x is AdjustmentGroup => Object.hasOwn(ADJUSTMENT_GROUPS, x);

const moneyProps = {
  type: 'number',
  inputMode: 'decimal',
  step: '0.01',
  placeholder: '0.00'
} as const;

const ReasonCodes = ({
  rows,
  onChange
}: {
  rows: readonly AdjustmentDraft[];
  onChange: (rows: AdjustmentDraft[]) => void;
}) => {
  const patch = (id: string, next: Partial<AdjustmentDraft>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r)));
  return (
    <FieldGroup title="Reason Codes">
      {rows.length ? (
        <ol className="flex flex-col gap-5">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-end gap-x-4 gap-y-5">
              <div className="min-w-48 flex-1">
                <Select
                  id={`adjustment-${r.id}-group`}
                  label="Group"
                  options={GROUP_OPTIONS}
                  value={r.group}
                  onChange={(v) => {
                    if (isGroup(v)) patch(r.id, { group: v });
                  }}
                />
              </div>
              <div className="w-28">
                <Input
                  id={`adjustment-${r.id}-reason`}
                  label="Code"
                  isMonospace
                  placeholder="45"
                  value={r.reason}
                  onChange={(e) => patch(r.id, { reason: e.target.value })}
                />
              </div>
              <div className="w-32">
                <Input
                  id={`adjustment-${r.id}-amount`}
                  label="Amount (USD)"
                  {...moneyProps}
                  value={r.amount}
                  onChange={(e) => patch(r.id, { amount: e.target.value })}
                />
              </div>
              <span className="flex h-10 items-center pointer-coarse:h-11">
                <RemoveButton
                  label={`Remove reason code ${i + 1}`}
                  onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                />
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div>
        <Button
          variant="outline"
          onClick={() =>
            onChange([...rows, { id: crypto.randomUUID(), group: 'CO', reason: '', amount: '' }])
          }
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          Add Reason Code
        </Button>
      </div>
    </FieldGroup>
  );
};

const emptyResponse = (coverageId: string): ResponseDraft => ({
  kind: 'response',
  coverageId,
  paid: '',
  adjusted: '',
  paidOn: '',
  checkNumber: '',
  payerClaimNumber: '',
  adjustments: [],
  note: ''
});

export const ResponseForm = ({
  coverages,
  current,
  locked,
  onRecord
}: {
  coverages: readonly ClaimCoverage[];
  current: string | null;
  locked: string | undefined;
  onRecord: (response: ClaimResponseInput) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useState(() => emptyResponse(current ?? ''));
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isRefund = draft.kind === 'refunded';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (locked) return;
    const response = toResponse(draft);
    if (typeof response === 'string') {
      setError(response);
      return;
    }
    setError('');
    setBusy(true);
    const recorded = await onRecord({ ...response, requestId });
    setBusy(false);
    if (recorded) {
      setDraft(emptyResponse(current ?? ''));
      setRequestId(crypto.randomUUID());
    }
  };
  const choice = (key: Exclude<keyof ResponseDraft, 'adjustments'>) => ({
    value: draft[key],
    onChange: (v: string) => setDraft({ ...draft, [key]: v })
  });
  const field = (key: Exclude<keyof ResponseDraft, 'adjustments'>) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => choice(key).onChange(e.target.value)
  });
  return (
    <SectionPanel
      title="Post Payment"
      description="A payer's remittance or a patient payment, or a refund of either. A payer payment that leaves a balance opens a reconcile task."
    >
      <form onSubmit={submit} className="flex flex-col gap-5" aria-label="Post payment">
        <fieldset disabled={Boolean(locked) || busy} className="flex flex-col gap-8">
          <FieldGrid>
            <Select
              id="response-payer"
              label="From"
              span={2}
              options={[
                ...coverages.map((c) => ({ value: c.id, label: c.payer })),
                { value: '', label: 'Patient' }
              ]}
              {...choice('coverageId')}
            />
            <Select id="response-kind" label="Type" options={KIND_OPTIONS} {...choice('kind')} />
            <Input id="response-paid-on" label="Paid On" type="date" {...field('paidOn')} />
            <Input
              id="response-paid"
              label={isRefund ? 'Refunded (USD)' : 'Paid (USD)'}
              min="0"
              {...moneyProps}
              {...field('paid')}
            />
            {isRefund ? null : (
              <Input
                id="response-adjusted"
                label="Adjusted (USD)"
                min="0"
                {...moneyProps}
                {...field('adjusted')}
              />
            )}
            <Input id="response-check" label="Check or EFT Number" {...field('checkNumber')} />
            {isRefund || draft.coverageId === '' ? null : (
              <Input
                id="response-payer-claim"
                label="Payer Claim Number"
                {...field('payerClaimNumber')}
              />
            )}
            <Input id="response-note" label="Note" span={4} {...field('note')} />
          </FieldGrid>
          {isRefund ? null : (
            <ReasonCodes
              rows={draft.adjustments}
              onChange={(adjustments) => setDraft({ ...draft, adjustments })}
            />
          )}
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <Button type="submit" isPending={busy} disabledReason={locked}>
            <SaveIcon aria-hidden="true" className="size-4" />
            {isRefund ? 'Record Refund' : 'Post Payment'}
          </Button>
        </FormActions>
      </form>
    </SectionPanel>
  );
};
