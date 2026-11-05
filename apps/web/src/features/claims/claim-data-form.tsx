import { SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid, FieldGroup, FieldGroups, type FieldSpan } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import {
  abnErrorOf,
  countErrorOf,
  type Draft,
  fromDraft,
  hasCountError,
  modifierErrorOf,
  type TextKey,
  toDraft
} from './claim-data-draft.ts';
import {
  DESTINATION_OPTIONS,
  FACILITY_STAY_OPTIONS,
  MSP_ACCIDENT_OPTIONS,
  MSP_QUESTIONS,
  ORIGIN_OPTIONS,
  PCS_OPTIONS,
  PCS_TYPE_OPTIONS,
  SIGNATURE_OPTIONS,
  TRANSPORT_REASON_OPTIONS,
  YES_NO
} from './claim-data-options.ts';
import type { BillingDataInput, ClaimDetail } from './client.ts';

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
    if (modifierErrorOf(draft) || hasCountError(draft) || abnErrorOf(draft)) return;
    setBusy(true);
    await onSave(fromDraft(draft, initial));
    setBusy(false);
  };
  const pick = (key: TextKey) => (v: string) => setDraft({ ...draft, [key]: v });
  const set = (key: TextKey) => (e: { target: { value: string } }) => pick(key)(e.target.value);
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
                  onChange={pick('originCode')}
                />
                <Select
                  id="destination-code"
                  label="Destination Type"
                  span={2}
                  options={DESTINATION_OPTIONS}
                  error={draft.destinationCode ? undefined : modifierError}
                  value={draft.destinationCode}
                  onChange={pick('destinationCode')}
                />
                <Input
                  id="patient-count"
                  label="Patients Transported"
                  hint="Two or more add GM to every line"
                  type="number"
                  min={1}
                  span={2}
                  value={draft.patientCount}
                  error={isChecked ? countErrorOf(draft, 'patientCount') : undefined}
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
                  onChange={pick('signature')}
                />
                <Select
                  id="transport-reason"
                  label="Transport Reason"
                  span={2}
                  options={TRANSPORT_REASON_OPTIONS}
                  value={draft.transportReason}
                  onChange={pick('transportReason')}
                />
                <Select
                  id="pcs-on-file"
                  label="Physician Certification"
                  span={2}
                  options={PCS_OPTIONS}
                  value={draft.pcsOnFile}
                  onChange={pick('pcsOnFile')}
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
                  onChange={pick('pcsType')}
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
                  error={isChecked ? countErrorOf(draft, 'roundTrips') : undefined}
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
                    onChange={pick(q.key)}
                  />
                ))}
                <Select
                  id="msp-accident"
                  label="Accident or Work Injury"
                  span={2}
                  options={MSP_ACCIDENT_OPTIONS}
                  value={draft.mspAccident}
                  onChange={pick('mspAccident')}
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
                  onChange={pick('denialExpected')}
                />
                <Select
                  id="abn-on-file"
                  label="ABN on File"
                  hint="Bills GA; without one an expected denial bills GZ"
                  span={2}
                  options={YES_NO}
                  value={draft.abnOnFile}
                  onChange={pick('abnOnFile')}
                />
                <Input
                  id="abn-signed-on"
                  label="ABN Signed On"
                  type="date"
                  span={2}
                  error={isChecked ? abnErrorOf(draft) : undefined}
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
                  onChange={pick('facilityStay')}
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
