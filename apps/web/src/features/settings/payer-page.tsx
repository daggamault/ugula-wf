import {
  CORRECTION_METHODS,
  type CorrectionMethod,
  MAX_APPEAL_DAYS,
  MAX_FILING_LIMIT_DAYS,
  PLAN_TYPES,
  type PlanType
} from '@ugula/billing';
import { SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { DeleteDialog } from '../../shared/ui/dialog.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { DeleteButton, RowActions } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { Payer, PayerAlias, PayerInput, SettingsClient } from './client.ts';
import { payerDeleteNote } from './payers-page.tsx';
import { FILING_OPTIONS } from './settings-page.tsx';

export const payerSavedNotice = (name: string, linkedClaims: number) =>
  linkedClaims
    ? `${name} saved and linked to ${linkedClaims} ${linkedClaims === 1 ? 'claim' : 'claims'}`
    : `${name} saved`;

const CORRECTION_OPTIONS = [
  { value: '', label: 'By kind of payer (Medicare reopens, others replace)' },
  ...Object.entries(CORRECTION_METHODS).map(([value, label]) => ({ value, label }))
];

const PLAN_OPTIONS = [
  { value: '', label: 'Unknown' },
  ...Object.entries(PLAN_TYPES).map(([value, label]) => ({ value, label }))
];

const isCorrectionMethod = (x: string): x is CorrectionMethod =>
  Object.hasOwn(CORRECTION_METHODS, x);

const isPlanType = (x: string): x is PlanType => Object.hasOwn(PLAN_TYPES, x);

const daysOf = (text: string) => (text === '' ? null : Number(text));

export const toPayerDraft = (p: Payer | null): PayerInput => ({
  name: p?.name ?? '',
  payerId: p?.payer_id ?? '',
  claimFiling: p?.claim_filing ?? 'CI',
  filingLimitDays: p?.filing_limit_days ?? null,
  correctionMethod: p?.correction_method ?? null,
  appealDays: p?.appeal_days ?? null,
  planType: p?.plan_type ?? null
});

export const PayerForm = ({
  payer,
  back,
  onSave
}: {
  payer: Payer | null;
  back: string;
  onSave: (payer: PayerInput) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toPayerDraft(payer));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const failure = await onSave(draft);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <form onSubmit={submit} aria-label="Save payer">
      <SectionPanel
        title="Payer"
        description="The clearinghouse payer ID and claim filing code come from your clearinghouse's payer list; each clearinghouse assigns its own IDs."
      >
        <fieldset disabled={busy}>
          <FieldGrid>
            <Input
              id="payer-name"
              label="Payer Name"
              span={2}
              required
              readOnly={payer !== null}
              hint={payer ? 'To rename a payer, add it again under the new name.' : undefined}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Input
              id="payer-id"
              label="Clearinghouse Payer ID"
              required
              isMonospace
              hint="2 to 80 letters or digits"
              value={draft.payerId}
              onChange={(e) => setDraft({ ...draft, payerId: e.target.value })}
            />
            <Select
              id="payer-filing"
              label="Claim Filing"
              options={FILING_OPTIONS}
              value={draft.claimFiling}
              onChange={(e) => setDraft({ ...draft, claimFiling: e.target.value })}
            />
            <Input
              id="payer-filing-limit"
              label="Filing Limit (Days)"
              type="number"
              min={1}
              max={MAX_FILING_LIMIT_DAYS}
              hint="Days from the date of service to file. Leave empty for 365 days on Medicare and TRICARE, and no limit otherwise."
              value={draft.filingLimitDays ?? ''}
              onChange={(e) => setDraft({ ...draft, filingLimitDays: daysOf(e.target.value) })}
            />
            <Select
              id="payer-corrections"
              label="Corrections"
              hint="Whether the payer takes replacement and void claims (frequency 7 or 8) or reopening requests."
              options={CORRECTION_OPTIONS}
              value={draft.correctionMethod ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  correctionMethod: isCorrectionMethod(e.target.value) ? e.target.value : null
                })
              }
            />
            <Input
              id="payer-appeal-days"
              label="Appeal Limit (Days)"
              type="number"
              min={1}
              max={MAX_APPEAL_DAYS}
              hint="Days from the remittance to appeal. Leave empty for the Appeal Levels table default; Medicare always uses its own limits."
              value={draft.appealDays ?? ''}
              onChange={(e) => setDraft({ ...draft, appealDays: daysOf(e.target.value) })}
            />
            <Select
              id="payer-plan-type"
              label="Plan Type"
              hint="Decides which balance-billing laws protect its members."
              options={PLAN_OPTIONS}
              value={draft.planType ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, planType: isPlanType(e.target.value) ? e.target.value : null })
              }
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
            Save Payer
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

export const LearnedNamesPanel = ({
  payer,
  onForget
}: {
  payer: Payer;
  onForget: (alias: PayerAlias) => void;
}) => (
  <SectionPanel
    title="Learned Names"
    description="Names on PCRs that a biller matched to this payer, so later PCRs with them link here."
  >
    {payer.aliases.length ? (
      <Table
        label={`Learned names for ${payer.name}`}
        head={['Name on PCRs', { label: 'Actions', isLabelHidden: true, isCompact: true }]}
      >
        {payer.aliases.map((a) => (
          <TableRow key={a.id}>
            <TableCell kind="wrap">{a.alias}</TableCell>
            <TableCell kind="actions">
              <RowActions>
                <DeleteButton name={a.alias} onClick={() => onForget(a)} />
              </RowActions>
            </TableCell>
          </TableRow>
        ))}
      </Table>
    ) : (
      <EmptyText>No learned names yet. They are added as billers match PCR payer names.</EmptyText>
    )}
  </SectionPanel>
);

type PayerPageProps = {
  client: SettingsClient;
  live: Live;
  payerId: string | null;
  back: string;
};

export const PayerPage = ({ client, live, payerId, back }: PayerPageProps) => {
  const payer = useResource(`payer:${payerId ?? 'new'}`, async (signal) =>
    payerId ? client.payer(payerId, signal) : null
  );
  useReconnect(live, payer.reload);
  const [deleting, setDeleting] = useState(false);
  const [forgetting, setForgetting] = useState<PayerAlias | null>(null);
  const notify = useToast();
  if (payer.error) return <PageFailure message={payer.error.message} />;
  const current = payer.data ?? null;
  const save = async (input: PayerInput) => {
    try {
      const saved = await client.savePayer(input);
      notify({ title: payerSavedNotice(saved.payer.name, saved.linkedClaims) });
      navigate(back);
      return null;
    } catch (err) {
      return messageOf(err);
    }
  };
  const remove = async (p: Payer) => {
    try {
      await client.removePayer(p.id);
      notify({ title: `${p.name} deleted` });
      navigate(back);
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete payer', description: messageOf(err) });
    }
  };
  const forget = async (p: Payer, a: PayerAlias) => {
    try {
      await client.forgetAlias(p.id, a.id);
      notify({ title: `${a.alias} deleted from ${p.name}` });
      payer.reload();
    } catch (err) {
      notify({ intent: 'danger', title: 'Could not delete name', description: messageOf(err) });
    }
  };
  return (
    <Page
      title={payerId ? (current?.name ?? 'Payer') : 'Add Payer'}
      description={
        payerId
          ? 'Change the clearinghouse payer ID or claim filing code used on 837P claims.'
          : 'Add a payer so claims billed to it can go in an 837P file.'
      }
      backTo={back}
      backLabel="Back to Payers"
      actions={
        current ? (
          <Button intent="danger" variant="outline" onClick={() => setDeleting(true)}>
            <Trash2Icon aria-hidden="true" className="size-4" />
            Delete Payer
          </Button>
        ) : null
      }
    >
      {payerId && payer.data === undefined ? (
        <PageLoading />
      ) : (
        <div className="flex flex-col gap-6">
          <PayerForm key={current?.id ?? 'new'} payer={current} back={back} onSave={save} />
          {current ? <LearnedNamesPanel payer={current} onForget={setForgetting} /> : null}
        </div>
      )}
      <DeleteDialog
        open={deleting}
        name={current?.name ?? ''}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          if (current) void remove(current);
        }}
      >
        {current ? payerDeleteNote(current.name) : null}
      </DeleteDialog>
      <DeleteDialog
        open={forgetting !== null}
        name={forgetting?.alias ?? ''}
        onClose={() => setForgetting(null)}
        onConfirm={() => {
          const alias = forgetting;
          setForgetting(null);
          if (current && alias) void forget(current, alias);
        }}
      >
        {forgetting && current
          ? `PCRs naming ${forgetting.alias} stop linking to ${current.name}; the next one goes to a Payer Matching task.`
          : null}
      </DeleteDialog>
    </Page>
  );
};
