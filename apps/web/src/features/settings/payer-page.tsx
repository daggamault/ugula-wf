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

export const toPayerDraft = (p: Payer | null): PayerInput => ({
  name: p?.name ?? '',
  payerId: p?.payer_id ?? '',
  claimFiling: p?.claim_filing ?? 'CI'
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
