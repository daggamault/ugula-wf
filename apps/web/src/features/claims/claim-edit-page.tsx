import {
  AMBULANCE_CONDITIONS,
  INSURED_RELATIONSHIPS,
  type InsuredRelationship,
  NOTE_LENGTH,
  ORIGIN_DESTINATION_CODES,
  RELATIONSHIP_LABELS,
  SELF,
  SERVICE_LEVELS,
  SEX_LABELS,
  SEXES,
  type ServiceLevel,
  type Sex,
  TRANSPORT_REASONS
} from '@ugula/billing';
import { deepEqual } from '@ugula/graph';
import { PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import type { ClaimDetail } from '../../shared/claims/claim-detail.ts';
import { formatDollars, parseDollars } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate, useUnsavedChanges } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import { Checkbox } from '../../shared/ui/checkbox.tsx';
import { FieldGrid, FieldGroup, FieldGroups, FormActions } from '../../shared/ui/field.tsx';
import { IconButton } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import { useSearch } from '../../shared/use-search.ts';
import type { ClaimEdit, ClaimsClient, DirectoryPayer } from './client.ts';

type PlaceDraft = Record<'name' | 'line' | 'city' | 'state' | 'postalCode', string>;

type CoverageDraft = {
  key: string;
  payerId: string;
  payerName: string;
  memberId: string;
  groupId: string;
  relationship: InsuredRelationship;
  insuredFirstName: string;
  insuredLastName: string;
};

type LineDraft = { key: string; code: string; modifiers: string; units: string; price: string };

export type ClaimDraft = {
  serviceDate: string;
  level: ServiceLevel;
  emergency: boolean;
  loadedMiles: string;
  originCode: string;
  destinationCode: string;
  transportReason: string;
  conditionCodes: string[];
  weightPounds: string;
  diagnoses: string;
  patient: {
    firstName: string;
    lastName: string;
    birthDate: string;
    sex: string;
    addressLine: string;
    city: string;
    state: string;
    postalCode: string;
  };
  pickup: PlaceDraft;
  destination: PlaceDraft;
  priorAuthorization: string;
  signatureOnFile: boolean;
  note: string;
  coverages: CoverageDraft[];
  lines: LineDraft[];
};

const text = (x: string | number | null | undefined) =>
  x === null || x === undefined ? '' : String(x);

const placeDraft = (c: ClaimDetail, p: 'pickup' | 'destination'): PlaceDraft => ({
  name: text(c[`${p}_name`]),
  line: text(c[`${p}_address_line`]),
  city: text(c[`${p}_city`]),
  state: text(c[`${p}_state`]),
  postalCode: text(c[`${p}_postal_code`])
});

export const toClaimDraft = (c: ClaimDetail): ClaimDraft => ({
  serviceDate: text(c.service_date),
  level: SERVICE_LEVELS.includes(c.level as ServiceLevel) ? (c.level as ServiceLevel) : 'BLS',
  emergency: c.is_emergency,
  loadedMiles: text(c.loaded_miles),
  originCode: text(c.origin_code),
  destinationCode: text(c.destination_code),
  transportReason: text(c.transport_reason),
  conditionCodes: [...c.condition_codes],
  weightPounds: text(c.weight_pounds),
  diagnoses: c.diagnoses.join(', '),
  patient: {
    firstName: text(c.first_name),
    lastName: text(c.last_name),
    birthDate: text(c.birth_date),
    sex: text(c.sex),
    addressLine: text(c.address_line),
    city: text(c.city),
    state: text(c.state),
    postalCode: text(c.postal_code)
  },
  pickup: placeDraft(c, 'pickup'),
  destination: placeDraft(c, 'destination'),
  priorAuthorization: text(c.prior_authorization),
  signatureOnFile: c.is_signature_on_file,
  note: text(c.note),
  coverages: c.coverages.map((cc) => ({
    key: cc.id,
    payerId: text(cc.payer_id),
    payerName: cc.payer,
    memberId: text(cc.member_id),
    groupId: text(cc.group_id),
    relationship: cc.relationship,
    insuredFirstName: text(cc.insured_first_name),
    insuredLastName: text(cc.insured_last_name)
  })),
  lines: c.lines.map((l) => ({
    key: `line-${l.position}`,
    code: l.code,
    modifiers: l.modifiers.join(' '),
    units: text(l.units),
    price: formatDollars(l.unit_cents)
  }))
});

const orNull = (x: string) => x.trim() || null;

const numberOrNull = (x: string) => (x.trim() ? Number(x) : null);

const place = (p: PlaceDraft) => ({
  name: orNull(p.name),
  line: orNull(p.line),
  city: orNull(p.city),
  state: orNull(p.state),
  postalCode: orNull(p.postalCode)
});

const listOf = (x: string) =>
  x
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

export const toClaimEdit = (d: ClaimDraft, revision: number): ClaimEdit | string => {
  const loadedMiles = numberOrNull(d.loadedMiles);
  if (loadedMiles !== null && !(loadedMiles >= 0)) return 'Enter loaded miles of zero or more.';
  const weightPounds = numberOrNull(d.weightPounds);
  if (weightPounds !== null && !(Number.isInteger(weightPounds) && weightPounds > 0)) {
    return 'Enter the weight in whole pounds.';
  }
  const lines: ClaimEdit['lines'] = [];
  for (const [i, l] of d.lines.entries()) {
    const units = Number(l.units);
    if (!(units > 0)) return `Enter the units of line ${i + 1}.`;
    const unitCents = parseDollars(l.price);
    if (unitCents === null) return `Enter the unit price of line ${i + 1}.`;
    lines.push({
      code: l.code.trim().toUpperCase(),
      modifiers: listOf(l.modifiers.toUpperCase()),
      units,
      unitCents
    });
  }
  return {
    revision,
    serviceDate: orNull(d.serviceDate),
    level: d.level,
    emergency: d.emergency,
    loadedMiles,
    originCode: orNull(d.originCode),
    destinationCode: orNull(d.destinationCode),
    transportReason: orNull(d.transportReason),
    conditionCodes: d.conditionCodes,
    weightPounds,
    diagnoses: listOf(d.diagnoses.toUpperCase()),
    patient: {
      firstName: d.patient.firstName.trim(),
      lastName: d.patient.lastName.trim(),
      birthDate: d.patient.birthDate,
      sex: SEXES.includes(d.patient.sex as Sex) ? (d.patient.sex as Sex) : null,
      addressLine: orNull(d.patient.addressLine),
      city: orNull(d.patient.city),
      state: orNull(d.patient.state),
      postalCode: orNull(d.patient.postalCode)
    },
    pickup: place(d.pickup),
    destination: place(d.destination),
    priorAuthorization: orNull(d.priorAuthorization),
    signatureOnFile: d.signatureOnFile,
    note: orNull(d.note),
    coverages: d.coverages.map((c) => ({
      payerId: orNull(c.payerId),
      payerName: c.payerName.trim(),
      memberId: orNull(c.memberId),
      groupId: orNull(c.groupId),
      relationship: c.relationship,
      insuredFirstName: orNull(c.insuredFirstName),
      insuredLastName: orNull(c.insuredLastName)
    })),
    lines
  };
};

const NONE = { value: '', label: 'None' };

const PLACE_OPTIONS = Object.entries(ORIGIN_DESTINATION_CODES).map(([value, label]) => ({
  value,
  label,
  code: value
}));

const ORIGIN_OPTIONS = [NONE, ...PLACE_OPTIONS.filter((o) => o.value !== 'X')];

const DESTINATION_OPTIONS = [NONE, ...PLACE_OPTIONS];

const REASON_OPTIONS = [
  NONE,
  ...Object.entries(TRANSPORT_REASONS).map(([value, label]) => ({ value, label, code: value }))
];

const CONDITION_OPTIONS = Object.entries(AMBULANCE_CONDITIONS).map(([value, label]) => ({
  value,
  label,
  code: value
}));

const LEVEL_OPTIONS = SERVICE_LEVELS.map((value) => ({ value, label: value }));

const SEX_OPTIONS = [NONE, ...SEXES.map((value) => ({ value, label: SEX_LABELS[value] }))];

const RELATIONSHIP_OPTIONS = INSURED_RELATIONSHIPS.map((value) => ({
  value,
  label: RELATIONSHIP_LABELS[value],
  code: value
}));

const newCoverage = (): CoverageDraft => ({
  key: crypto.randomUUID(),
  payerId: '',
  payerName: '',
  memberId: '',
  groupId: '',
  relationship: SELF,
  insuredFirstName: '',
  insuredLastName: ''
});

const newLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  code: '',
  modifiers: '',
  units: '1',
  price: ''
});

type FindPayers = (q: string, signal: AbortSignal) => Promise<DirectoryPayer[]>;

const PayerPicker = ({
  id,
  findPayers,
  coverage,
  onChange
}: {
  id: string;
  findPayers: FindPayers;
  coverage: CoverageDraft;
  onChange: (payer: DirectoryPayer) => void;
}) => {
  const search = useSearch<DirectoryPayer>(id, findPayers, 'Type part of a payer name');
  return (
    <Select
      id={id}
      label="Payer"
      span={2}
      required
      hint={coverage.payerId ? undefined : 'Not in the payer directory; choose the payer it is.'}
      summary={coverage.payerName || 'Choose a payer'}
      options={search.results.map((p) => ({ value: p.id, label: p.name }))}
      value={coverage.payerId}
      onSearch={search.onSearch}
      emptyText={search.emptyText}
      onChange={(v) => {
        const payer = search.results.find((p) => p.id === v);
        if (payer) onChange(payer);
      }}
    />
  );
};

const PlaceFields = ({
  id,
  value,
  onChange
}: {
  id: string;
  value: PlaceDraft;
  onChange: (next: PlaceDraft) => void;
}) => {
  const field = (key: keyof PlaceDraft) => ({
    value: value[key],
    onChange: (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value })
  });
  return (
    <FieldGrid>
      <Input id={`${id}-name`} label="Name" span={2} maxLength={60} {...field('name')} />
      <Input id={`${id}-line`} label="Street Address" span={2} maxLength={55} {...field('line')} />
      <Input id={`${id}-city`} label="City" maxLength={30} {...field('city')} />
      <Input id={`${id}-state`} label="State" maxLength={2} placeholder="OH" {...field('state')} />
      <Input id={`${id}-zip`} label="ZIP Code" maxLength={10} {...field('postalCode')} />
    </FieldGrid>
  );
};

export const ClaimForm = ({
  claim,
  findPayers,
  back,
  onSave
}: {
  claim: ClaimDetail;
  findPayers: FindPayers;
  back: string;
  onSave: (edit: ClaimEdit) => Promise<string | null>;
}) => {
  const [draft, setDraft] = useState(() => toClaimDraft(claim));
  useUnsavedChanges(!deepEqual(draft, toClaimDraft(claim)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof ClaimDraft>(key: K, value: ClaimDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const field = (
    key:
      | 'serviceDate'
      | 'loadedMiles'
      | 'weightPounds'
      | 'diagnoses'
      | 'priorAuthorization'
      | 'note'
  ) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value)
  });
  const patientField = (key: keyof ClaimDraft['patient']) => ({
    value: draft.patient[key],
    onChange: (e: { target: { value: string } }) =>
      set('patient', { ...draft.patient, [key]: e.target.value })
  });
  const setCoverage = (i: number, patch: Partial<CoverageDraft>) =>
    set(
      'coverages',
      draft.coverages.map((c, k) => (k === i ? { ...c, ...patch } : c))
    );
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    set(
      'lines',
      draft.lines.map((l, k) => (k === i ? { ...l, ...patch } : l))
    );
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const edit = toClaimEdit(draft, claim.revision);
    if (typeof edit === 'string') {
      setError(edit);
      return;
    }
    setBusy(true);
    setError('');
    const failure = await onSave(edit);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <form onSubmit={submit} aria-label="Save Claim">
      <SectionPanel
        title="Claim"
        description="Saving makes a new revision of the claim, which a biller reviews again before it goes out."
      >
        <fieldset disabled={busy}>
          <FieldGroups>
            <FieldGroup title="Service">
              <FieldGrid>
                <Input
                  id="claim-date"
                  label="Date of Service"
                  type="date"
                  {...field('serviceDate')}
                />
                <Select
                  id="claim-level"
                  label="Level of Service"
                  options={LEVEL_OPTIONS}
                  value={draft.level}
                  onChange={(v) => set('level', v as ServiceLevel)}
                />
                <Input
                  id="claim-miles"
                  label="Loaded Miles"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  {...field('loadedMiles')}
                />
                <label
                  htmlFor="claim-emergency"
                  className="flex cursor-pointer items-center gap-2 self-end text-sm font-medium sm:h-10"
                >
                  <Checkbox
                    id="claim-emergency"
                    checked={draft.emergency}
                    onChange={(e) => set('emergency', e.target.checked)}
                  />
                  Emergency
                </label>
                <Select
                  id="claim-origin"
                  label="Origin"
                  options={ORIGIN_OPTIONS}
                  value={draft.originCode}
                  onChange={(v) => set('originCode', v)}
                />
                <Select
                  id="claim-destination"
                  label="Destination"
                  options={DESTINATION_OPTIONS}
                  value={draft.destinationCode}
                  onChange={(v) => set('destinationCode', v)}
                />
                <Select
                  id="claim-reason"
                  label="Transport Reason"
                  span={2}
                  options={REASON_OPTIONS}
                  value={draft.transportReason}
                  onChange={(v) => set('transportReason', v)}
                />
                <Select
                  id="claim-conditions"
                  label="Condition Codes"
                  span={2}
                  isMultiple
                  hint="Up to five."
                  options={CONDITION_OPTIONS}
                  value={draft.conditionCodes}
                  onChange={(v) => set('conditionCodes', v)}
                />
                <Input
                  id="claim-weight"
                  label="Patient Weight (lb)"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  {...field('weightPounds')}
                />
                <Input
                  id="claim-authorization"
                  label="Prior Authorization"
                  maxLength={50}
                  {...field('priorAuthorization')}
                />
                <label
                  htmlFor="claim-signature"
                  className="flex cursor-pointer items-center gap-2 self-end text-sm font-medium sm:h-10"
                >
                  <Checkbox
                    id="claim-signature"
                    checked={draft.signatureOnFile}
                    onChange={(e) => set('signatureOnFile', e.target.checked)}
                  />
                  Signature on File
                </label>
                <Input
                  id="claim-diagnoses"
                  label="Diagnosis Codes"
                  span={2}
                  isMonospace
                  hint="ICD-10 codes, primary first, separated by commas."
                  {...field('diagnoses')}
                />
                <Input
                  id="claim-note"
                  label="Claim Note"
                  span={2}
                  maxLength={NOTE_LENGTH}
                  hint={`For the payer, at most ${NOTE_LENGTH} characters.`}
                  {...field('note')}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Patient">
              <FieldGrid>
                <Input
                  id="patient-first"
                  label="First Name"
                  required
                  maxLength={35}
                  {...patientField('firstName')}
                />
                <Input
                  id="patient-last"
                  label="Last Name"
                  required
                  maxLength={60}
                  {...patientField('lastName')}
                />
                <Input
                  id="patient-born"
                  label="Birth Date"
                  type="date"
                  required
                  {...patientField('birthDate')}
                />
                <Select
                  id="patient-sex"
                  label="Sex"
                  options={SEX_OPTIONS}
                  value={draft.patient.sex}
                  onChange={(v) => set('patient', { ...draft.patient, sex: v })}
                />
                <Input
                  id="patient-line"
                  label="Street Address"
                  span={2}
                  maxLength={55}
                  {...patientField('addressLine')}
                />
                <Input id="patient-city" label="City" maxLength={30} {...patientField('city')} />
                <Input
                  id="patient-state"
                  label="State"
                  maxLength={2}
                  placeholder="OH"
                  {...patientField('state')}
                />
                <Input
                  id="patient-zip"
                  label="ZIP Code"
                  maxLength={10}
                  {...patientField('postalCode')}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Pickup Location">
              <PlaceFields id="pickup" value={draft.pickup} onChange={(v) => set('pickup', v)} />
            </FieldGroup>
            <FieldGroup title="Destination Location">
              <PlaceFields
                id="destination"
                value={draft.destination}
                onChange={(v) => set('destination', v)}
              />
            </FieldGroup>
            <FieldGroup title="Payers">
              {draft.coverages.map((c, i) => (
                <section
                  key={c.key}
                  aria-label={`Payer ${i + 1}`}
                  className="border-border flex flex-col gap-4 rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Payer {i + 1}</span>
                    <IconButton
                      label={`Remove Payer ${i + 1}`}
                      icon={Trash2Icon}
                      intent="danger"
                      onClick={() =>
                        set(
                          'coverages',
                          draft.coverages.filter((_, k) => k !== i)
                        )
                      }
                    />
                  </div>
                  <FieldGrid>
                    <PayerPicker
                      id={`coverage-${c.key}-payer`}
                      findPayers={findPayers}
                      coverage={c}
                      onChange={(p) => setCoverage(i, { payerId: p.id, payerName: p.name })}
                    />
                    <Input
                      id={`coverage-${i}-member`}
                      label="Member ID"
                      maxLength={80}
                      value={c.memberId}
                      onChange={(e) => setCoverage(i, { memberId: e.target.value })}
                    />
                    <Input
                      id={`coverage-${i}-group`}
                      label="Group ID"
                      maxLength={50}
                      value={c.groupId}
                      onChange={(e) => setCoverage(i, { groupId: e.target.value })}
                    />
                    <Select
                      id={`coverage-${i}-relationship`}
                      label="Relationship to the Insured"
                      options={RELATIONSHIP_OPTIONS}
                      value={c.relationship}
                      onChange={(v) => setCoverage(i, { relationship: v as InsuredRelationship })}
                    />
                    {c.relationship === SELF ? null : (
                      <>
                        <Input
                          id={`coverage-${i}-insured-first`}
                          label="Insured First Name"
                          maxLength={35}
                          value={c.insuredFirstName}
                          onChange={(e) => setCoverage(i, { insuredFirstName: e.target.value })}
                        />
                        <Input
                          id={`coverage-${i}-insured-last`}
                          label="Insured Last Name"
                          maxLength={60}
                          value={c.insuredLastName}
                          onChange={(e) => setCoverage(i, { insuredLastName: e.target.value })}
                        />
                      </>
                    )}
                  </FieldGrid>
                </section>
              ))}
              <div>
                <Button
                  variant="outline"
                  onClick={() => set('coverages', [...draft.coverages, newCoverage()])}
                >
                  <PlusIcon aria-hidden="true" className="size-4" />
                  Add Payer
                </Button>
              </div>
            </FieldGroup>
            <FieldGroup title="Charge Lines">
              {draft.lines.map((l, i) => (
                <section key={l.key} aria-label={`Line ${i + 1}`} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <FieldGrid>
                      <Input
                        id={`line-${i}-code`}
                        label="HCPCS"
                        required
                        isMonospace
                        maxLength={5}
                        value={l.code}
                        onChange={(e) => setLine(i, { code: e.target.value })}
                      />
                      <Input
                        id={`line-${i}-modifiers`}
                        label="Modifiers"
                        isMonospace
                        placeholder="RH QL"
                        value={l.modifiers}
                        onChange={(e) => setLine(i, { modifiers: e.target.value })}
                      />
                      <Input
                        id={`line-${i}-units`}
                        label="Units"
                        type="number"
                        inputMode="decimal"
                        min="0.1"
                        step="0.1"
                        required
                        value={l.units}
                        onChange={(e) => setLine(i, { units: e.target.value })}
                      />
                      <Input
                        id={`line-${i}-price`}
                        label="Unit Price (USD)"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        required
                        value={l.price}
                        onChange={(e) => setLine(i, { price: e.target.value })}
                      />
                    </FieldGrid>
                  </div>
                  <IconButton
                    label={`Remove Line ${i + 1}`}
                    icon={Trash2Icon}
                    intent="danger"
                    onClick={() =>
                      set(
                        'lines',
                        draft.lines.filter((_, k) => k !== i)
                      )
                    }
                  />
                </section>
              ))}
              <div>
                <Button variant="outline" onClick={() => set('lines', [...draft.lines, newLine()])}>
                  <PlusIcon aria-hidden="true" className="size-4" />
                  Add Line
                </Button>
              </div>
            </FieldGroup>
          </FieldGroups>
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <FormActions>
          <ButtonLink to={back} variant="outline">
            <XIcon aria-hidden="true" className="size-4" />
            Cancel
          </ButtonLink>
          <Button type="submit" isPending={busy}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Claim
          </Button>
        </FormActions>
      </SectionPanel>
    </form>
  );
};

type ClaimEditPageProps = { client: ClaimsClient; live: Live; claimId: string };

export const ClaimEditPage = ({ client, live, claimId }: ClaimEditPageProps) => {
  const detail = useResource(`claim:${claimId}`, (signal) => client.find(claimId, signal));
  useReconnect(live, detail.reload);
  const notify = useToast();
  const back = `/claims/${claimId}`;
  if (detail.error) return <PageFailure message={detail.error.message} />;
  const claim = detail.data?.claim;
  const save = async (edit: ClaimEdit) => {
    try {
      const saved = await client.edit(claimId, edit);
      notify({ title: `Claim ${claim?.number ?? ''} saved as revision ${saved.revision}` });
      navigate(back, { force: true });
      return null;
    } catch (err) {
      return messageOf(err);
    }
  };
  return (
    <Page
      title={claim ? `Edit Claim ${claim.number}` : 'Edit Claim'}
      backTo={back}
      backLabel="Back to Claim"
    >
      {claim ? (
        <ClaimForm
          key={`${claim.id}:${claim.revision}`}
          claim={claim}
          findPayers={client.payers}
          back={back}
          onSave={save}
        />
      ) : (
        <PageLoading />
      )}
    </Page>
  );
};
