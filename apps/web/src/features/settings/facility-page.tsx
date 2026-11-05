import { FACILITY_KINDS, type FacilityKind } from '@ugula/billing';
import { SaveIcon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { Facility, FacilityInput, SettingsClient } from './client.ts';

export const toFacilityDraft = (f: Facility | null): FacilityInput => ({
  name: f?.name ?? '',
  addressLine: f?.address_line ?? null,
  city: f?.city ?? null,
  state: f?.state ?? null,
  postalCode: f?.postal_code ?? null,
  phone: f?.phone ?? null,
  kind: f?.kind ?? 'other',
  contract: f?.contract ?? false,
  contractNote: f?.contract_note ?? null
});

const KIND_OPTIONS = Object.entries(FACILITY_KINDS).map(([value, label]) => ({ value, label }));

const CONTRACT_OPTIONS = [
  { value: 'no', label: 'No: its patients’ payers are billed' },
  { value: 'yes', label: 'Yes: the facility pays for its transports' }
];

const FIELDS = [
  { key: 'addressLine', label: 'Street Address', span: 2 },
  { key: 'city', label: 'City', span: 1 },
  { key: 'state', label: 'State', span: 1 },
  { key: 'postalCode', label: 'ZIP Code', span: 1 },
  { key: 'phone', label: 'Phone', span: 1 }
] as const;

export const FacilityForm = ({
  facility,
  back,
  onSave
}: {
  facility: Facility | null;
  back: string;
  onSave: (facility: FacilityInput) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toFacilityDraft(facility));
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
    <form onSubmit={submit} aria-label="Save facility">
      <SectionPanel
        title="Facility"
        description="The name and mailing address its monthly invoice goes to, its kind, and whether it pays for its transports under contract."
      >
        <fieldset disabled={busy}>
          <FieldGrid>
            <Input
              id="facility-name"
              label="Facility Name"
              span={2}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            {FIELDS.map((f) => (
              <Input
                key={f.key}
                id={`facility-${f.key}`}
                label={f.label}
                span={f.span}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value || null })}
              />
            ))}
            <Select
              id="facility-kind"
              label="Kind"
              span={1}
              options={KIND_OPTIONS}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as FacilityKind })}
            />
            <Select
              id="facility-contract"
              label="Contract"
              hint="Transports to or from a contract facility are billed to it"
              span={1}
              options={CONTRACT_OPTIONS}
              value={draft.contract ? 'yes' : 'no'}
              onChange={(e) => setDraft({ ...draft, contract: e.target.value === 'yes' })}
            />
            <Input
              id="facility-contract-note"
              label="Contract Note"
              span={2}
              value={draft.contractNote ?? ''}
              onChange={(e) => setDraft({ ...draft, contractNote: e.target.value || null })}
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
            Save Facility
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

type FacilityPageProps = {
  client: SettingsClient;
  live: Live;
  facilityId: string | null;
  back: string;
};

export const FacilityPage = ({ client, live, facilityId, back }: FacilityPageProps) => {
  const facility = useResource(`facility:${facilityId ?? 'new'}`, async (signal) =>
    facilityId ? client.facility(facilityId, signal) : null
  );
  useReconnect(live, facility.reload);
  const notify = useToast();
  if (facility.error) return <PageFailure message={facility.error.message} />;
  const current = facility.data ?? null;
  const save = async (input: FacilityInput) => {
    try {
      await client.saveFacility(facilityId, input);
      notify({ title: `${input.name} saved` });
      navigate(back);
      return null;
    } catch (err) {
      return messageOf(err);
    }
  };
  return (
    <Page
      title={facilityId ? (current?.name ?? 'Facility') : 'Add Facility'}
      description="A facility pays for the trips it is responsible for, on one invoice a month."
      backTo={back}
      backLabel="Back to Facilities"
    >
      {facilityId && facility.data === undefined ? (
        <PageLoading />
      ) : (
        <FacilityForm key={current?.id ?? 'new'} facility={current} back={back} onSave={save} />
      )}
    </Page>
  );
};
