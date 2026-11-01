import { CLAIM_FILING_CODES } from '@ugula/billing';
import { PencilIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { ConfirmDialog } from '../../shared/ui/dialog.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid, FieldGroup, FieldGroups, type FieldSpan } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { pageOf, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type {
  BillingProfile,
  BillingProfileInput,
  Payer,
  PayerAlias,
  SettingsClient
} from './client.ts';

export type SettingsPageProps = {
  client: SettingsClient;
};

export const FILING_OPTIONS = Object.entries(CLAIM_FILING_CODES).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

type ProfileText = Exclude<keyof BillingProfileInput, 'production'>;

export type ProfileDraft = Record<ProfileText, string> & { usage: 'T' | 'P' };

export const toProfileDraft = (p: BillingProfile | null): ProfileDraft => ({
  organizationName: p?.organization_name ?? '',
  npi: p?.npi ?? '',
  taxId: p?.tax_id ?? '',
  addressLine: p?.address_line ?? '',
  city: p?.city ?? '',
  state: p?.state ?? '',
  postalCode: p?.postal_code ?? '',
  phone: p?.phone ?? '',
  submitterId: p?.submitter_id ?? '',
  receiverId: p?.receiver_id ?? '',
  receiverName: p?.receiver_name ?? '',
  usage: p?.production ? 'P' : 'T'
});

const blankToNull = (s: string) => s.trim() || null;

export const fromProfileDraft = ({ usage, ...d }: ProfileDraft): BillingProfileInput => ({
  ...d,
  submitterId: blankToNull(d.submitterId),
  receiverId: blankToNull(d.receiverId),
  receiverName: blankToNull(d.receiverName),
  production: usage === 'P'
});

type ProfileField = { key: ProfileText; label: string; hint?: string; span?: FieldSpan };

const AGENCY_FIELDS: ProfileField[] = [
  { key: 'organizationName', label: 'Organization name', span: 4 },
  { key: 'npi', label: 'NPI', hint: '10 digits' },
  { key: 'taxId', label: 'Tax ID (EIN)', hint: '9 digits' },
  { key: 'phone', label: 'Billing phone', hint: '10 digits', span: 2 }
];

const ADDRESS_FIELDS: ProfileField[] = [
  { key: 'addressLine', label: 'Street', span: 4 },
  { key: 'city', label: 'City', span: 2 },
  { key: 'state', label: 'State', hint: '2 letters' },
  { key: 'postalCode', label: 'ZIP code' }
];

const CLEARINGHOUSE_FIELDS: ProfileField[] = [
  { key: 'submitterId', label: 'Submitter ID', hint: 'Assigned by your clearinghouse' },
  { key: 'receiverId', label: 'Receiver ID', hint: 'The clearinghouse ID' },
  { key: 'receiverName', label: 'Clearinghouse name' }
];

const USAGE_OPTIONS = [
  { value: 'T', label: 'Test files' },
  { value: 'P', label: 'Production files' }
];

export const ProfileForm = ({
  profile,
  onSave
}: {
  profile: BillingProfile | null;
  onSave: (profile: BillingProfileInput) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useState(() => toProfileDraft(profile));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    await onSave(fromProfileDraft(draft));
    setBusy(false);
  };
  const inputs = (fields: ProfileField[], required: boolean) =>
    fields.map((f) => (
      <Input
        key={f.key}
        id={`profile-${f.key}`}
        label={f.label}
        hint={f.hint}
        span={f.span}
        required={required}
        value={draft[f.key]}
        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
      />
    ));
  return (
    <form onSubmit={submit} aria-label="Billing profile">
      <SectionPanel
        title="Billing Profile"
        description="Your agency as it appears on 837P claims and patient statements."
        actions={
          <Button type="submit" size="sm" isPending={busy}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Save profile
          </Button>
        }
      >
        <fieldset disabled={busy}>
          <FieldGroups>
            <FieldGroup title="Agency">
              <FieldGrid>{inputs(AGENCY_FIELDS, true)}</FieldGrid>
            </FieldGroup>
            <FieldGroup title="Remit-to Address">
              <FieldGrid>{inputs(ADDRESS_FIELDS, true)}</FieldGrid>
            </FieldGroup>
            <FieldGroup title="Clearinghouse">
              <FieldGrid>
                {inputs(CLEARINGHOUSE_FIELDS, false)}
                <Select
                  id="profile-usage"
                  label="837P files are"
                  options={USAGE_OPTIONS}
                  value={draft.usage}
                  onChange={(e) =>
                    setDraft({ ...draft, usage: e.target.value === 'P' ? 'P' : 'T' })
                  }
                />
              </FieldGrid>
            </FieldGroup>
          </FieldGroups>
        </fieldset>
      </SectionPanel>
    </form>
  );
};

const PayerNames = ({
  payer,
  onForget
}: {
  payer: Payer;
  onForget: (payer: Payer, alias: PayerAlias) => void;
}) =>
  payer.aliases.length ? (
    <ul aria-label={`Report names for ${payer.name}`} className="flex flex-wrap gap-1">
      {payer.aliases.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            aria-label={`Forget ${a.alias} for ${payer.name}`}
            onClick={() => onForget(payer, a)}
            className={classNamesOf(
              interactiveClasses,
              'border-border text-surface-fg-muted hover:border-danger/40 hover:bg-danger/10 hover:text-danger inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2 text-xs'
            )}
          >
            {a.alias}
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  ) : null;

export const PAYER_TABLE = {
  prefix: 'payers',
  sorts: { name: 'asc', payerId: 'asc', filing: 'asc' },
  sort: 'name'
} as const;

const PAYER_VALUES = {
  name: (p: Payer) => p.name,
  payerId: (p: Payer) => p.payer_id,
  filing: (p: Payer) => p.claim_filing
};

export const PayerDirectory = ({
  payers,
  onSave,
  onDelete,
  onForget
}: {
  payers: readonly Payer[];
  onSave: (payer: { name: string; payerId: string; claimFiling: string }) => Promise<boolean>;
  onDelete: (payer: Payer) => void;
  onForget: (payer: Payer, alias: PayerAlias) => void;
}) => {
  const empty = { name: '', payerId: '', claimFiling: 'CI' };
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<Payer | null>(null);
  const table = useTableState('/settings', PAYER_TABLE);
  const reset = () => {
    setDraft(empty);
    setEditing(false);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await onSave(draft)) reset();
  };
  return (
    <SectionPanel
      title="Payer Directory"
      description="Payer IDs and claim filing codes used on 837P claims. Payer names from reports are matched to this list automatically when the match is clear; anything else becomes a Payer matching task."
    >
      <form
        onSubmit={submit}
        className={`flex flex-col gap-4 rounded-lg border p-4 ${editing ? 'border-primary/40 bg-primary/5' : 'border-border bg-canvas'}`}
        aria-label="Save payer"
      >
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,16rem)]">
          <Input
            id="payer-name"
            label="Payer name"
            required
            readOnly={editing}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <Input
            id="payer-id"
            label="Payer ID"
            required
            isMonospace
            value={draft.payerId}
            onChange={(e) => setDraft({ ...draft, payerId: e.target.value })}
          />
          <Select
            id="payer-filing"
            label="Claim filing"
            options={FILING_OPTIONS}
            value={draft.claimFiling}
            onChange={(e) => setDraft({ ...draft, claimFiling: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">
            <SaveIcon aria-hidden="true" className="size-4" />
            {editing ? 'Update payer' : 'Save payer'}
          </Button>
          {editing ? (
            <Button variant="outline" onClick={reset}>
              <XIcon aria-hidden="true" className="size-4" />
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
      {payers.length ? (
        <Table
          label="Payer directory"
          sorting={table}
          head={[
            { label: 'Payer', sort: 'name' },
            { label: 'Payer ID', sort: 'payerId' },
            { label: 'Claim Filing', isSecondary: true, sort: 'filing' },
            { label: 'Actions', isLabelHidden: true, isCompact: true }
          ]}
        >
          {pageOf(payers, table, PAYER_VALUES).items.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <span className="flex flex-col gap-1.5">
                  <span className="font-medium">{p.name}</span>
                  <PayerNames payer={p} onForget={onForget} />
                </span>
              </TableCell>
              <TableCell>
                <span className="font-mono">{p.payer_id}</span>
              </TableCell>
              <TableCell isMuted isSecondary>
                {FILING_OPTIONS.find((o) => o.value === p.claim_filing)?.label ?? p.claim_filing}
              </TableCell>
              <TableCell kind="actions">
                <span className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => {
                      setEditing(true);
                      setDraft({ name: p.name, payerId: p.payer_id, claimFiling: p.claim_filing });
                    }}
                  >
                    <PencilIcon aria-hidden="true" className="size-4" />
                    Edit
                  </Button>
                  <Button
                    intent="danger"
                    variant="outline"
                    size="sm"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2Icon aria-hidden="true" className="size-4" />
                    Delete
                  </Button>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      ) : null}
      {payers.length ? (
        <Pagination label="Payers" total={payers.length} state={table} />
      ) : (
        <EmptyText>
          No payers yet. Claims cannot be put in an 837P file until their payers are listed here.
        </EmptyText>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Payer?"
        intent="danger"
        confirmLabel="Delete"
        confirmIcon={Trash2Icon}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) onDelete(deleting);
          setDeleting(null);
        }}
      >
        {deleting
          ? `Its prices are removed, and claims billed to ${deleting.name} cannot go in an 837P file until it is added again.`
          : null}
      </ConfirmDialog>
    </SectionPanel>
  );
};

export const payerSavedNotice = (name: string, linkedClaims: number) =>
  linkedClaims
    ? `${name} saved and linked to ${linkedClaims} ${linkedClaims === 1 ? 'claim' : 'claims'}.`
    : `${name} saved.`;

export const SettingsPage = ({ client }: SettingsPageProps) => {
  const profile = useResource('billing-profile', client.profile);
  const payers = useResource('payers', client.payers);
  const [error, setError] = useState('');
  const notify = useToast();
  const act = async <T,>(
    action: () => Promise<T>,
    done: (result: T) => string,
    reload: () => void
  ) => {
    setError('');
    try {
      notify({ title: done(await action()) });
      reload();
      return true;
    } catch (err) {
      setError(messageOf(err));
      return false;
    }
  };
  return (
    <Page
      title="Settings"
      description="Billing identity and payer details used on claims and statements."
    >
      {error ? <Alert>{error}</Alert> : null}
      {profile.data !== undefined ? (
        <ProfileForm
          profile={profile.data}
          onSave={(p) =>
            act(
              () => client.saveProfile(p),
              () => 'Billing profile saved.',
              profile.reload
            )
          }
        />
      ) : (
        <PageLoading />
      )}
      {payers.data ? (
        <PayerDirectory
          payers={payers.data}
          onSave={(p) =>
            act(
              () => client.savePayer(p),
              (saved) => payerSavedNotice(saved.payer.name, saved.linkedClaims),
              payers.reload
            )
          }
          onDelete={(p) =>
            void act(
              () => client.removePayer(p.id),
              () => `${p.name} deleted.`,
              payers.reload
            )
          }
          onForget={(p, a) =>
            void act(
              () => client.forgetAlias(p.id, a.id),
              () => `Reports naming ${a.alias} no longer link to ${p.name}.`,
              payers.reload
            )
          }
        />
      ) : null}
    </Page>
  );
};
