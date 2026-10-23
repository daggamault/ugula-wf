import { ORIGIN_DESTINATION_CODES } from '@ugula/billing';
import { SaveIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '../../shared/ui/button.tsx';
import { FieldGrid, FieldGroup, FieldGroups, type FieldSpan } from '../../shared/ui/field.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { BillingDataInput, ClaimDetail, LocationInput } from './client.ts';

type Draft = {
  patient: Record<'addressLine' | 'city' | 'state' | 'postalCode', string>;
  coverages: { payer: string; memberId: string; groupId: string }[];
  serviceDate: string;
  pickup: Record<keyof LocationInput, string>;
  destination: Record<keyof LocationInput, string>;
  diagnoses: string;
  originCode: string;
  destinationCode: string;
};

const MODIFIER_OPTIONS = Object.entries(ORIGIN_DESTINATION_CODES).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

const NOT_SET = { value: '', label: 'Not set' };

export const ORIGIN_OPTIONS = [NOT_SET, ...MODIFIER_OPTIONS.filter((o) => o.value !== 'X')];

export const DESTINATION_OPTIONS = [NOT_SET, ...MODIFIER_OPTIONS];

const blank = (x: string | null | undefined) => x ?? '';

const orNull = (x: string) => (x.trim() ? x.trim() : null);

const location = (l: LocationInput | undefined) => ({
  name: blank(l?.name),
  addressLine: blank(l?.addressLine),
  city: blank(l?.city),
  state: blank(l?.state),
  postalCode: blank(l?.postalCode)
});

export const toDraft = (claim: ClaimDetail): Draft => ({
  patient: {
    addressLine: blank(claim.address_line),
    city: blank(claim.city),
    state: blank(claim.state),
    postalCode: blank(claim.postal_code)
  },
  coverages: claim.payers.map((payer) => {
    const c = claim.coverages.find((x) => x.payer === payer);
    return { payer, memberId: blank(c?.memberId), groupId: blank(c?.groupId) };
  }),
  serviceDate: blank(claim.details.serviceDate),
  pickup: location(claim.details.pickup),
  destination: location(claim.details.destination),
  diagnoses: claim.details.diagnoses.join(', '),
  originCode: claim.details.originDestination?.[0] ?? '',
  destinationCode: claim.details.originDestination?.[1] ?? ''
});

const fromLocation = (l: Record<keyof LocationInput, string>): LocationInput => ({
  name: orNull(l.name),
  addressLine: orNull(l.addressLine),
  city: orNull(l.city),
  state: orNull(l.state),
  postalCode: orNull(l.postalCode)
});

export const fromDraft = (d: Draft): BillingDataInput => ({
  patient: {
    addressLine: orNull(d.patient.addressLine),
    city: orNull(d.patient.city),
    state: orNull(d.patient.state),
    postalCode: orNull(d.patient.postalCode)
  },
  coverages: d.coverages.map((c) => ({
    payer: c.payer,
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
  originDestination: d.originCode && d.destinationCode ? d.originCode + d.destinationCode : null
});

const ADDRESS_LABELS: Record<string, string> = {
  name: 'Facility',
  addressLine: 'Street',
  city: 'City',
  state: 'State',
  postalCode: 'ZIP'
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
  disabled,
  onSave
}: {
  claim: ClaimDetail;
  disabled: boolean;
  onSave: (data: BillingDataInput) => Promise<boolean>;
}) => {
  const [draft, setDraft] = useState(() => toDraft(claim));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    await onSave(fromDraft(draft));
    setBusy(false);
  };
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
        description="What goes on the 837P: patient address, member IDs, and transport details."
        actions={
          <Button
            type="submit"
            size="sm"
            isPending={busy}
            disabledReason={disabled ? 'This claim is closed.' : undefined}
          >
            <SaveIcon aria-hidden="true" className="size-4" />
            Save claim data
          </Button>
        }
      >
        <fieldset disabled={disabled || busy}>
          <FieldGroups>
            <FieldGroup title="Patient Mailing Address">
              <FieldGrid>
                {address('patient', 'patient', ['addressLine', 'city', 'state', 'postalCode'])}
              </FieldGrid>
            </FieldGroup>
            {draft.coverages.map((c, i) => (
              <FieldGroup key={c.payer} title={c.payer}>
                <FieldGrid>
                  {(['memberId', 'groupId'] as const).map((key) => (
                    <Input
                      key={key}
                      id={`coverage-${i}-${key}`}
                      label={key === 'memberId' ? 'Member ID' : 'Group number'}
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
                  label="Date of service"
                  type="date"
                  span={2}
                  value={draft.serviceDate}
                  onChange={(e) => setDraft({ ...draft, serviceDate: e.target.value })}
                />
                <Input
                  id="diagnoses"
                  label="Diagnosis codes (ICD-10-CM)"
                  hint="Comma separated, first is primary"
                  span={2}
                  isMonospace
                  value={draft.diagnoses}
                  onChange={(e) => setDraft({ ...draft, diagnoses: e.target.value })}
                />
                <Select
                  id="origin-code"
                  label="Picked up from"
                  span={2}
                  options={ORIGIN_OPTIONS}
                  value={draft.originCode}
                  onChange={(e) => setDraft({ ...draft, originCode: e.target.value })}
                />
                <Select
                  id="destination-code"
                  label="Taken to"
                  span={2}
                  options={DESTINATION_OPTIONS}
                  value={draft.destinationCode}
                  onChange={(e) => setDraft({ ...draft, destinationCode: e.target.value })}
                />
              </FieldGrid>
            </FieldGroup>
            <div className="grid gap-8 lg:grid-cols-2">
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
