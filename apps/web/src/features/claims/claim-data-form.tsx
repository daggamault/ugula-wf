import {
  FACILITY_STAYS,
  type FacilityStay,
  isSignatureStatus,
  isTransportReason,
  MSP_ACCIDENTS,
  type MspAccident,
  ORIGIN_DESTINATION_CODES,
  PCS_TYPES,
  type PcsType,
  SIGNATURE_LABELS,
  SIGNATURE_STATUSES,
  TRANSPORT_REASONS
} from '@ugula/billing';
import { SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid, FieldGroup, FieldGroups, type FieldSpan } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { BillingDataInput, ClaimDetail, DocumentationInput, LocationInput } from './client.ts';

type Draft = {
  patient: Record<'addressLine' | 'city' | 'state' | 'postalCode', string>;
  coverages: { id: string; payer: string; memberId: string; groupId: string }[];
  serviceDate: string;
  pickup: Record<keyof LocationInput, string>;
  destination: Record<keyof LocationInput, string>;
  diagnoses: string;
  originCode: string;
  destinationCode: string;
  signature: string;
  transportReason: string;
  pcsOnFile: string;
  pcsSignedOn: string;
  pcsType: string;
  patientCount: string;
  abnOnFile: string;
  abnSignedOn: string;
  denialExpected: string;
  mspEmployerPlan: string;
  mspEsrd: string;
  mspDisability: string;
  mspAccident: string;
  priorAuthorization: string;
  priorAuthorizationExpiresOn: string;
  roundTrips: string;
  admissionDate: string;
  facilityStay: string;
};

type TextKey = { [K in keyof Draft]: Draft[K] extends string ? K : never }[keyof Draft];

type Flag = 'abnOnFile' | 'denialExpected' | 'mspEmployerPlan' | 'mspEsrd' | 'mspDisability';

const MODIFIER_OPTIONS = Object.entries(ORIGIN_DESTINATION_CODES).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

const NOT_SET = { value: '', label: 'Not Set' };

export const ORIGIN_OPTIONS = [NOT_SET, ...MODIFIER_OPTIONS.filter((o) => o.value !== 'X')];

export const DESTINATION_OPTIONS = [NOT_SET, ...MODIFIER_OPTIONS];

const SIGNATURE_OPTIONS = SIGNATURE_STATUSES.map((value) => ({
  value,
  label: SIGNATURE_LABELS[value]
}));

const TRANSPORT_REASON_OPTIONS = [
  NOT_SET,
  ...Object.entries(TRANSPORT_REASONS).map(([value, label]) => ({
    value,
    label: `${value} · ${label}`
  }))
];

const PCS_OPTIONS = [
  { value: '', label: 'Unknown' },
  { value: 'yes', label: 'On File' },
  { value: 'no', label: 'Not on File' }
];

const YES_NO = [
  { value: '', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

const choicesOf = (labels: Readonly<Record<string, string>>) => [
  { value: '', label: 'Unknown' },
  ...Object.entries(labels).map(([value, label]) => ({ value, label }))
];

const MSP_ACCIDENT_OPTIONS = choicesOf(MSP_ACCIDENTS);

const PCS_TYPE_OPTIONS = choicesOf(PCS_TYPES);

const FACILITY_STAY_OPTIONS = choicesOf(FACILITY_STAYS);

const MSP_QUESTIONS: { key: Flag; label: string; hint: string }[] = [
  {
    key: 'mspEmployerPlan',
    label: 'Employer Group Health Plan',
    hint: 'Covered through the patient’s or spouse’s current employment'
  },
  {
    key: 'mspEsrd',
    label: 'End-Stage Renal Disease',
    hint: 'In the 30-month coordination period'
  },
  {
    key: 'mspDisability',
    label: 'Disability With a Large Group Plan',
    hint: 'Under 65, covered through a plan of 100 or more employees'
  }
];

const pcsOf = (x: boolean | null) => (x === null ? '' : x ? 'yes' : 'no');

const flagOf = (x: string) => (x === 'yes' ? true : x === 'no' ? false : null);

const countOf = (x: string) => {
  const n = x.trim() ? Number(x) : Number.NaN;
  return Number.isInteger(n) ? n : null;
};

const blank = (x: string | null | undefined) => x ?? '';

const orNull = (x: string) => (x.trim() ? x.trim() : null);

export const toDraft = (claim: ClaimDetail): Draft => ({
  patient: {
    addressLine: blank(claim.address_line),
    city: blank(claim.city),
    state: blank(claim.state),
    postalCode: blank(claim.postal_code)
  },
  coverages: claim.coverages.map((c) => ({
    id: c.id,
    payer: c.payer,
    memberId: blank(c.member_id),
    groupId: blank(c.group_id)
  })),
  serviceDate: blank(claim.service_date),
  pickup: {
    name: '',
    addressLine: blank(claim.pickup_address_line),
    city: blank(claim.pickup_city),
    state: blank(claim.pickup_state),
    postalCode: blank(claim.pickup_postal_code)
  },
  destination: {
    name: blank(claim.destination_name),
    addressLine: blank(claim.destination_address_line),
    city: blank(claim.destination_city),
    state: blank(claim.destination_state),
    postalCode: blank(claim.destination_postal_code)
  },
  diagnoses: claim.diagnoses.join(', '),
  originCode: blank(claim.origin_code),
  destinationCode: blank(claim.destination_code),
  signature: claim.signature,
  transportReason: blank(claim.transport_reason),
  pcsOnFile: pcsOf(claim.pcs_on_file),
  pcsSignedOn: blank(claim.pcs_signed_on),
  pcsType: blank(claim.pcs_type),
  patientCount: claim.patient_count === null ? '' : String(claim.patient_count),
  abnOnFile: pcsOf(claim.abn_on_file),
  abnSignedOn: blank(claim.abn_signed_on),
  denialExpected: pcsOf(claim.denial_expected),
  mspEmployerPlan: pcsOf(claim.msp_employer_plan),
  mspEsrd: pcsOf(claim.msp_esrd),
  mspDisability: pcsOf(claim.msp_disability),
  mspAccident: blank(claim.msp_accident),
  priorAuthorization: blank(claim.prior_authorization),
  priorAuthorizationExpiresOn: blank(claim.prior_authorization_expires_on),
  roundTrips: claim.round_trips === null ? '' : String(claim.round_trips),
  admissionDate: blank(claim.admission_date),
  facilityStay: blank(claim.facility_stay)
});

const fromLocation = (l: Record<keyof LocationInput, string>): LocationInput => ({
  name: orNull(l.name),
  addressLine: orNull(l.addressLine),
  city: orNull(l.city),
  state: orNull(l.state),
  postalCode: orNull(l.postalCode)
});

const changed = <T, V>(next: T, before: T, value: V): V | null => (next === before ? null : value);

const text = (d: Draft, before: Draft, key: TextKey) =>
  orNull(changed(d[key], before[key], d[key]) ?? '');

const flag = (d: Draft, before: Draft, key: Flag) => changed(d[key], before[key], flagOf(d[key]));

const choice = <T extends string>(d: Draft, before: Draft, key: TextKey) =>
  (orNull(changed(d[key], before[key], d[key]) ?? '') as T | null) ?? null;

const documentationOf = (d: Draft, before: Draft): BillingDataInput['documentation'] => {
  const doc: DocumentationInput = {
    signature: isSignatureStatus(d.signature)
      ? changed(d.signature, before.signature, d.signature)
      : null,
    pcsOnFile: d.pcsOnFile ? changed(d.pcsOnFile, before.pcsOnFile, d.pcsOnFile === 'yes') : null,
    pcsSignedOn: text(d, before, 'pcsSignedOn'),
    transportReason: isTransportReason(d.transportReason)
      ? changed(d.transportReason, before.transportReason, d.transportReason)
      : null,
    patientCount: changed(d.patientCount, before.patientCount, countOf(d.patientCount)),
    abnOnFile: flag(d, before, 'abnOnFile'),
    abnSignedOn: text(d, before, 'abnSignedOn'),
    denialExpected: flag(d, before, 'denialExpected'),
    mspEmployerPlan: flag(d, before, 'mspEmployerPlan'),
    mspEsrd: flag(d, before, 'mspEsrd'),
    mspDisability: flag(d, before, 'mspDisability'),
    mspAccident: choice<MspAccident>(d, before, 'mspAccident'),
    priorAuthorization: text(d, before, 'priorAuthorization'),
    priorAuthorizationExpiresOn: text(d, before, 'priorAuthorizationExpiresOn'),
    pcsType: choice<PcsType>(d, before, 'pcsType'),
    roundTrips: changed(d.roundTrips, before.roundTrips, countOf(d.roundTrips)),
    admissionDate: text(d, before, 'admissionDate'),
    facilityStay: choice<FacilityStay>(d, before, 'facilityStay')
  };
  return Object.values(doc).some((v) => v !== null) ? doc : null;
};

export const fromDraft = (d: Draft, before: Draft = d): BillingDataInput => ({
  patient: {
    addressLine: orNull(d.patient.addressLine),
    city: orNull(d.patient.city),
    state: orNull(d.patient.state),
    postalCode: orNull(d.patient.postalCode)
  },
  coverages: d.coverages.map((c) => ({
    id: c.id,
    memberId: orNull(c.memberId),
    groupId: orNull(c.groupId)
  })),
  serviceDate: orNull(d.serviceDate),
  pickup: fromLocation(d.pickup),
  destination: fromLocation(d.destination),
  diagnoses: d.diagnoses
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean),
  originDestination: d.originCode && d.destinationCode ? d.originCode + d.destinationCode : null,
  documentation: documentationOf(d, before)
});

export const modifierErrorOf = (d: Pick<Draft, 'originCode' | 'destinationCode'>) =>
  Boolean(d.originCode) === Boolean(d.destinationCode)
    ? undefined
    : 'Choose both a pickup and a destination type, or neither.';

const ADDRESS_LABELS: Record<string, string> = {
  name: 'Facility',
  addressLine: 'Street',
  city: 'City',
  state: 'State',
  postalCode: 'ZIP Code'
};

const ADDRESS_SPANS: Record<string, FieldSpan> = {
  name: 4,
  addressLine: 4,
  city: 2,
  state: 1,
  postalCode: 1
};

export const ClaimDataForm = ({
  claim,
  locked,
  onSave
}: {
  claim: ClaimDetail;
  locked: string | undefined;
  onSave: (data: BillingDataInput) => Promise<boolean>;
}) => {
  const [initial] = useState(() => toDraft(claim));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [isChecked, setChecked] = useState(false);
  const modifierError = isChecked ? modifierErrorOf(draft) : undefined;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (locked) return;
    setChecked(true);
    if (modifierErrorOf(draft)) return;
    setBusy(true);
    await onSave(fromDraft(draft, initial));
    setBusy(false);
  };
  const set = (key: TextKey) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });
  const address = <K extends 'patient' | 'pickup' | 'destination'>(
    group: K,
    prefix: string,
    fields: (keyof Draft[K])[]
  ) =>
    fields.map((key) => (
      <Input
        key={`${prefix}-${String(key)}`}
        id={`${prefix}-${String(key)}`}
        label={ADDRESS_LABELS[String(key)] ?? String(key)}
        span={ADDRESS_SPANS[String(key)] ?? 1}
        value={String(draft[group][key])}
        onChange={(e) =>
          setDraft({ ...draft, [group]: { ...draft[group], [key]: e.target.value } })
        }
      />
    ));
  return (
    <form onSubmit={submit} aria-label="Claim data">
      <SectionPanel
        title="Claim Data"
        description="What goes on the 837P: patient address, member IDs, transport details, documentation, Medicare Secondary Payer answers and the facility stay."
        actions={
          <Button type="submit" isPending={busy} disabledReason={locked}>
            <SaveIcon aria-hidden="true" className="size-4" />
            Save Claim Data
          </Button>
        }
      >
        <fieldset disabled={Boolean(locked) || busy}>
          <FieldGroups>
            <FieldGroup title="Patient Mailing Address">
              <FieldGrid>
                {address('patient', 'patient', ['addressLine', 'city', 'state', 'postalCode'])}
              </FieldGrid>
            </FieldGroup>
            {draft.coverages.map((c, i) => (
              <FieldGroup key={c.id} title={c.payer}>
                <FieldGrid>
                  {(['memberId', 'groupId'] as const).map((key) => (
                    <Input
                      key={key}
                      id={`coverage-${i}-${key}`}
                      label={key === 'memberId' ? 'Member ID' : 'Group Number'}
                      span={2}
                      value={c[key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          coverages: draft.coverages.map((x, j) =>
                            j === i ? { ...x, [key]: e.target.value } : x
                          )
                        })
                      }
                    />
                  ))}
                </FieldGrid>
              </FieldGroup>
            ))}
            <FieldGroup title="Transport">
              <FieldGrid>
                <Input
                  id="service-date"
                  label="Date of Service"
                  type="date"
                  span={2}
                  value={draft.serviceDate}
                  onChange={(e) => setDraft({ ...draft, serviceDate: e.target.value })}
                />
                <Input
                  id="diagnoses"
                  label="Diagnosis Codes (ICD-10-CM)"
                  hint="Comma separated, first is primary"
                  span={2}
                  isMonospace
                  value={draft.diagnoses}
                  onChange={(e) => setDraft({ ...draft, diagnoses: e.target.value })}
                />
                <Select
                  id="origin-code"
                  label="Pickup Type"
                  span={2}
                  options={ORIGIN_OPTIONS}
                  error={draft.originCode ? undefined : modifierError}
                  value={draft.originCode}
                  onChange={(e) => setDraft({ ...draft, originCode: e.target.value })}
                />
                <Select
                  id="destination-code"
                  label="Destination Type"
                  span={2}
                  options={DESTINATION_OPTIONS}
                  error={draft.destinationCode ? undefined : modifierError}
                  value={draft.destinationCode}
                  onChange={(e) => setDraft({ ...draft, destinationCode: e.target.value })}
                />
                <Input
                  id="patient-count"
                  label="Patients Transported"
                  hint="Two or more add GM to every line"
                  type="number"
                  min={1}
                  span={2}
                  value={draft.patientCount}
                  onChange={set('patientCount')}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Documentation">
              <FieldGrid>
                <Select
                  id="signature"
                  label="Billing Signature"
                  span={2}
                  options={SIGNATURE_OPTIONS}
                  value={draft.signature}
                  onChange={(e) => setDraft({ ...draft, signature: e.target.value })}
                />
                <Select
                  id="transport-reason"
                  label="Transport Reason"
                  span={2}
                  options={TRANSPORT_REASON_OPTIONS}
                  value={draft.transportReason}
                  onChange={(e) => setDraft({ ...draft, transportReason: e.target.value })}
                />
                <Select
                  id="pcs-on-file"
                  label="Physician Certification"
                  span={2}
                  options={PCS_OPTIONS}
                  value={draft.pcsOnFile}
                  onChange={(e) => setDraft({ ...draft, pcsOnFile: e.target.value })}
                />
                <Input
                  id="pcs-signed-on"
                  label="Certification Signed On"
                  type="date"
                  span={2}
                  value={draft.pcsSignedOn}
                  onChange={(e) => setDraft({ ...draft, pcsSignedOn: e.target.value })}
                />
                <Select
                  id="pcs-type"
                  label="Certification Type"
                  span={2}
                  options={PCS_TYPE_OPTIONS}
                  value={draft.pcsType}
                  onChange={set('pcsType')}
                />
                <Input
                  id="prior-authorization"
                  label="Prior Authorization (UTN)"
                  span={2}
                  isMonospace
                  value={draft.priorAuthorization}
                  onChange={set('priorAuthorization')}
                />
                <Input
                  id="prior-authorization-expires-on"
                  label="Authorization Expires On"
                  type="date"
                  span={2}
                  value={draft.priorAuthorizationExpiresOn}
                  onChange={set('priorAuthorizationExpiresOn')}
                />
                <Input
                  id="round-trips"
                  label="Round Trips in the Series"
                  hint="Repetitive Medicare trips need a UTN after the third"
                  type="number"
                  min={0}
                  span={2}
                  value={draft.roundTrips}
                  onChange={set('roundTrips')}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Medicare Secondary Payer">
              <FieldGrid>
                {MSP_QUESTIONS.map((q) => (
                  <Select
                    key={q.key}
                    id={`msp-${q.key}`}
                    label={q.label}
                    hint={q.hint}
                    span={2}
                    options={YES_NO}
                    value={draft[q.key]}
                    onChange={set(q.key)}
                  />
                ))}
                <Select
                  id="msp-accident"
                  label="Accident or Work Injury"
                  span={2}
                  options={MSP_ACCIDENT_OPTIONS}
                  value={draft.mspAccident}
                  onChange={set('mspAccident')}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Advance Beneficiary Notice">
              <FieldGrid>
                <Select
                  id="denial-expected"
                  label="Medicare Expected to Deny"
                  hint="Not reasonable and necessary for this patient"
                  span={2}
                  options={YES_NO}
                  value={draft.denialExpected}
                  onChange={set('denialExpected')}
                />
                <Select
                  id="abn-on-file"
                  label="ABN on File"
                  hint="Bills GA; without one an expected denial bills GZ"
                  span={2}
                  options={YES_NO}
                  value={draft.abnOnFile}
                  onChange={set('abnOnFile')}
                />
                <Input
                  id="abn-signed-on"
                  label="ABN Signed On"
                  type="date"
                  span={2}
                  value={draft.abnSignedOn}
                  onChange={set('abnSignedOn')}
                />
              </FieldGrid>
            </FieldGroup>
            <FieldGroup title="Facility Stay">
              <FieldGrid>
                <Select
                  id="facility-stay"
                  label="Facility Stay During the Trip"
                  hint="A Part A stay can make the facility responsible"
                  span={2}
                  options={FACILITY_STAY_OPTIONS}
                  value={draft.facilityStay}
                  onChange={set('facilityStay')}
                />
                <Input
                  id="admission-date"
                  label="Admission Date"
                  type="date"
                  span={2}
                  value={draft.admissionDate}
                  onChange={set('admissionDate')}
                />
              </FieldGrid>
            </FieldGroup>
            <div className="grid gap-x-4 gap-y-8 lg:grid-cols-2">
              <FieldGroup title="Pickup">
                <FieldGrid>
                  {address('pickup', 'pickup', ['addressLine', 'city', 'state', 'postalCode'])}
                </FieldGrid>
              </FieldGroup>
              <FieldGroup title="Destination">
                <FieldGrid>
                  {address('destination', 'destination', [
                    'name',
                    'addressLine',
                    'city',
                    'state',
                    'postalCode'
                  ])}
                </FieldGrid>
              </FieldGroup>
            </div>
          </FieldGroups>
        </fieldset>
      </SectionPanel>
    </form>
  );
};
