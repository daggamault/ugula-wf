import { CLAIM_FILING_CODES } from '@ugula/billing';
import { SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid, FieldGroup, FieldGroups, type FieldSpan } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { BillingProfile, BillingProfileInput, SettingsClient } from './client.ts';

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

export const SettingsPage = ({ client }: SettingsPageProps) => {
  const profile = useResource('billing-profile', client.profile);
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
      description="Your agency's billing identity and clearinghouse, used on every claim and statement."
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
    </Page>
  );
};
