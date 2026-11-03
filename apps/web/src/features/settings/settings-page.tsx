import { CLAIM_FILING_CODES } from '@ugula/billing';
import { SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import {
  FieldGrid,
  FieldGroup,
  FieldGroups,
  type FieldSpan,
  FormActions
} from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { BillingProfile, BillingProfileInput, SettingsClient } from './client.ts';

type SettingsPageProps = {
  client: SettingsClient;
  live: Live;
};

export const FILING_OPTIONS = Object.entries(CLAIM_FILING_CODES).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

type ProfileText = Exclude<keyof BillingProfileInput, 'production'>;

type ProfileDraft = Record<ProfileText, string> & { usage: 'T' | 'P' };

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const timeZoneOptions = (current: string) => {
  const zones = Intl.supportedValuesOf('timeZone');
  return (zones.includes(current) ? zones : [current, ...zones]).map((z) => ({
    value: z,
    label: z.replaceAll('_', ' ')
  }));
};

export const toProfileDraft = (
  p: BillingProfile | null,
  defaultZone: string = browserZone()
): ProfileDraft => ({
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
  timeZone: p?.time_zone ?? defaultZone,
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

type ProfileField = {
  key: Exclude<ProfileText, 'timeZone'>;
  label: string;
  hint?: string;
  span?: FieldSpan;
  pattern?: string;
};

const AGENCY_FIELDS: ProfileField[] = [
  { key: 'organizationName', label: 'Organization Name', span: 4 },
  { key: 'npi', label: 'NPI', hint: '10 digits' },
  { key: 'taxId', label: 'Tax ID (EIN)', hint: '9 digits' },
  { key: 'phone', label: 'Billing Phone', hint: '10 digits', span: 2 }
];

const ADDRESS_FIELDS: ProfileField[] = [
  { key: 'addressLine', label: 'Street', span: 4 },
  { key: 'city', label: 'City', span: 2 },
  { key: 'state', label: 'State', hint: '2 letters' },
  {
    key: 'postalCode',
    label: 'ZIP+4 Code',
    hint: 'All 9 digits, like 62704-1234',
    pattern: '\\d{5}-?\\d{4}'
  }
];

const CLEARINGHOUSE_FIELDS: ProfileField[] = [
  { key: 'submitterId', label: 'Submitter ID', hint: 'Assigned by your clearinghouse' },
  { key: 'receiverId', label: 'Receiver ID', hint: 'The clearinghouse ID' },
  { key: 'receiverName', label: 'Clearinghouse Name' }
];

const USAGE_OPTIONS = [
  { value: 'T', label: 'Test Files' },
  { value: 'P', label: 'Production Files' }
];

export const ProfileForm = ({
  profile,
  onSave
}: {
  profile: BillingProfile | null;
  onSave: (profile: BillingProfileInput) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toProfileDraft(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setError((await onSave(fromProfileDraft(draft))) ?? '');
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
        pattern={f.pattern}
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
      >
        <fieldset disabled={busy}>
          <FieldGroups>
            <FieldGroup title="Agency">
              <FieldGrid>
                {inputs(AGENCY_FIELDS, true)}
                <Select
                  id="profile-timeZone"
                  label="Time Zone"
                  hint="Dates on claims and statements use this zone."
                  span={2}
                  required
                  options={timeZoneOptions(draft.timeZone)}
                  value={draft.timeZone}
                  onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Remit-to Address">
              <FieldGrid>{inputs(ADDRESS_FIELDS, true)}</FieldGrid>
            </FieldGroup>
            <FieldGroup title="Clearinghouse">
              <FieldGrid>
                {inputs(CLEARINGHOUSE_FIELDS, false)}
                <Select
                  id="profile-usage"
                  label="837P Files"
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
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <Button type="submit" isPending={busy}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Profile
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

export const SettingsPage = ({ client, live }: SettingsPageProps) => {
  const profile = useResource('billing-profile', client.profile);
  useReconnect(live, profile.reload);
  const notify = useToast();
  if (profile.error) return <PageFailure message={profile.error.message} />;
  return (
    <Page
      title="Settings"
      description="Your agency's billing identity and clearinghouse, used on every claim and statement."
    >
      {profile.data !== undefined ? (
        <ProfileForm
          profile={profile.data}
          onSave={async (p) => {
            try {
              await client.saveProfile(p);
              notify({ title: 'Billing profile saved' });
              profile.reload();
              return null;
            } catch (err) {
              return messageOf(err);
            }
          }}
        />
      ) : (
        <PageLoading />
      )}
    </Page>
  );
};
