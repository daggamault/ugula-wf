import { FACILITY_KINDS, isFacilityKind } from '@ugula/billing';
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
import { useSearch } from '../../shared/use-search.ts';
import type { CmsHospital, FacilitiesClient, Facility, FacilityInput } from './client.ts';

export const toFacilityDraft = (f: Facility | null): FacilityInput => ({
  name: f?.name ?? '',
  addressLine: f?.address_line ?? null,
  city: f?.city ?? null,
  state: f?.state ?? null,
  postalCode: f?.postal_code ?? null,
  phone: f?.phone ?? null,
  kind: f?.kind ?? 'other',
  hasContract: f?.has_contract ?? false,
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

type FindHospitals = (q: string, signal?: AbortSignal) => Promise<CmsHospital[]>;

export const hospitalLabel = (h: CmsHospital) => `${h.name}, ${h.city} ${h.state} (${h.ccn})`;

export const fromHospital = (draft: FacilityInput, h: CmsHospital): FacilityInput => ({
  ...draft,
  name: h.name,
  addressLine: h.address_line,
  city: h.city,
  state: h.state,
  postalCode: h.postal_code,
  phone: h.phone ?? draft.phone,
  kind: 'hospital'
});

const HospitalPicker = ({
  findHospitals,
  onPick
}: {
  findHospitals: FindHospitals;
  onPick: (hospital: CmsHospital) => void;
}) => {
  const search = useSearch<CmsHospital>(
    'cms-hospitals',
    (q, signal) => (q ? findHospitals(q, signal) : Promise.resolve([])),
    'Type part of a hospital name'
  );
  return (
    <Select
      id="facility-hospital"
      label="Fill From CMS Hospital"
      span={2}
      hint="Fills the name, address, phone and kind from the CMS hospital list"
      placeholder="Search hospitals"
      options={search.results.map((h) => ({ value: h.ccn, label: hospitalLabel(h) }))}
      value=""
      onSearch={search.onSearch}
      emptyText={search.emptyText}
      onChange={(ccn) => {
        const hospital = search.results.find((h) => h.ccn === ccn);
        if (hospital) onPick(hospital);
      }}
    />
  );
};

export const FacilityForm = ({
  facility,
  findHospitals,
  back,
  onSave
}: {
  facility: Facility | null;
  findHospitals: FindHospitals;
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
      <SectionPanel title="Facility">
        <fieldset disabled={busy}>
          <FieldGrid>
            {facility ? null : (
              <HospitalPicker
                findHospitals={findHospitals}
                onPick={(h) => setDraft((d) => fromHospital(d, h))}
              />
            )}
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
              onChange={(kind) => {
                if (isFacilityKind(kind)) setDraft({ ...draft, kind });
              }}
            />
            <Select
              id="facility-contract"
              label="Contract"
              hint="Transports to or from a contract facility are billed to it"
              span={1}
              options={CONTRACT_OPTIONS}
              value={draft.hasContract ? 'yes' : 'no'}
              onChange={(v) => setDraft({ ...draft, hasContract: v === 'yes' })}
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
  client: FacilitiesClient;
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
      await client.save(facilityId, input);
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
      backTo={back}
      backLabel="Back to Facilities"
    >
      {facilityId && facility.data === undefined ? (
        <PageLoading />
      ) : (
        <FacilityForm
          key={current?.id ?? 'new'}
          facility={current}
          findHospitals={client.hospitals}
          back={back}
          onSave={save}
        />
      )}
    </Page>
  );
};
