import {
  AMBULANCE_CONDITIONS,
  FACILITY_STAYS,
  MSP_ACCIDENTS,
  PCS_TYPES,
  poundsOf,
  SIGNATURE_LABELS,
  TRANSPORT_REASONS
} from '@ugula/billing';
import { DownloadIcon, ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import type { ClaimCoverage, ClaimDetail } from './client.ts';

type Documented = Pick<
  ClaimDetail,
  | 'signature'
  | 'signature_note'
  | 'pcs_on_file'
  | 'pcs_signed_on'
  | 'transport_reason'
  | 'condition_codes'
  | 'prior_authorization'
  | 'weight_kg'
  | 'at_scene_at'
  | 'left_scene_at'
  | 'at_destination_at'
  | 'patient_count'
  | 'closest_facility_miles'
  | 'abn_on_file'
  | 'abn_signed_on'
  | 'denial_expected'
  | 'msp_employer_plan'
  | 'msp_esrd'
  | 'msp_disability'
  | 'msp_accident'
  | 'prior_authorization_expires_on'
  | 'pcs_type'
  | 'round_trips'
  | 'admission_date'
  | 'facility_stay'
  | 'deceased'
  | 'non_covered_miles'
>;

const SIGNATURE_INTENTS: Record<ClaimDetail['signature'], StatusBadgeStyle['intent']> = {
  signed: 'success',
  exception: 'warning',
  refused: 'danger',
  missing: 'danger'
};

export const pcsText = (c: Pick<Documented, 'pcs_on_file' | 'pcs_signed_on'>) =>
  c.pcs_on_file === null
    ? 'Not recorded'
    : c.pcs_on_file
      ? `On file${c.pcs_signed_on ? `, signed ${formatDate(c.pcs_signed_on)}` : ''}`
      : 'Not on file';

export const abnText = (
  c: Pick<Documented, 'abn_on_file' | 'abn_signed_on' | 'denial_expected'>
) =>
  c.abn_on_file === null
    ? c.denial_expected
      ? 'Not recorded, and Medicare is expected to deny (GZ)'
      : 'Not recorded'
    : c.abn_on_file
      ? `On file${c.abn_signed_on ? `, signed ${formatDate(c.abn_signed_on)}` : ''} (GA)`
      : c.denial_expected
        ? 'Not on file, and Medicare is expected to deny (GZ)'
        : 'Not on file';

const MSP_REASONS = [
  ['msp_employer_plan', 'Employer group health plan'],
  ['msp_esrd', 'End-stage renal disease'],
  ['msp_disability', 'Disability with a large group plan']
] as const;

export const mspText = (
  c: Pick<Documented, 'msp_employer_plan' | 'msp_esrd' | 'msp_disability' | 'msp_accident'>
) => {
  const first = [
    ...(c.msp_accident && c.msp_accident !== 'none' ? [MSP_ACCIDENTS[c.msp_accident]] : []),
    ...MSP_REASONS.flatMap(([key, label]) => (c[key] ? [label] : []))
  ];
  if (first.length) return `Medicare pays second: ${first.join('; ')}`;
  const answered = c.msp_accident !== null && MSP_REASONS.every(([key]) => c[key] !== null);
  return answered ? 'Medicare pays first' : 'Not answered';
};

export const authorizationText = (
  c: Pick<Documented, 'prior_authorization' | 'prior_authorization_expires_on' | 'round_trips'>
) =>
  [
    c.prior_authorization
      ? `${c.prior_authorization}${c.prior_authorization_expires_on ? `, expires ${formatDate(c.prior_authorization_expires_on)}` : ''}`
      : null,
    c.round_trips === null ? null : `round trip ${c.round_trips}`
  ]
    .filter(Boolean)
    .join(' · ') || null;

export const stayText = (c: Pick<Documented, 'facility_stay' | 'admission_date'>) =>
  [
    c.facility_stay ? FACILITY_STAYS[c.facility_stay] : null,
    c.admission_date ? `admitted ${formatDate(c.admission_date)}` : null
  ]
    .filter(Boolean)
    .join(', ') || null;

export const milesText = (
  c: Pick<Documented, 'closest_facility_miles' | 'non_covered_miles' | 'deceased'>
) =>
  c.deceased
    ? 'Pronounced dead before loading: BLS with QL, no mileage'
    : [
        c.closest_facility_miles === null
          ? null
          : `${Number(c.closest_facility_miles)} mi to the closest hospital`,
        c.non_covered_miles === null
          ? null
          : `${Number(c.non_covered_miles)} mi non-covered (A0888)`
      ]
        .filter(Boolean)
        .join(', ') || null;

export const weightText = (kg: string | null) =>
  kg === null ? null : `${Number(kg)} kg (${poundsOf(Number(kg))} lb)`;

export const conditionsText = (codes: readonly string[]) =>
  codes
    .map((c) =>
      Object.hasOwn(AMBULANCE_CONDITIONS, c)
        ? `${c} · ${AMBULANCE_CONDITIONS[c as keyof typeof AMBULANCE_CONDITIONS]}`
        : c
    )
    .join('; ');

export const DocumentationPanel = ({ claim }: { claim: Documented }) => (
  <SectionPanel
    title="Documentation"
    description="What the report and billers document for billing: signature, certification, transport reason, MSP answers, ABN, authorization, facility stay and trip times."
  >
    <DetailList>
      <Detail label="Billing Signature">
        <span className="flex flex-col gap-0.5">
          <span>
            <Badge intent={SIGNATURE_INTENTS[claim.signature]}>
              {SIGNATURE_LABELS[claim.signature]}
            </Badge>
          </span>
          {claim.signature_note ? (
            <span className="text-surface-fg-muted text-xs">{claim.signature_note}</span>
          ) : null}
        </span>
      </Detail>
      <Detail label="Physician Certification">
        {pcsText(claim)}
        {claim.pcs_type ? ` · ${PCS_TYPES[claim.pcs_type]}` : ''}
      </Detail>
      <Detail label="Medicare Secondary Payer">{mspText(claim)}</Detail>
      <Detail label="Advance Beneficiary Notice">{abnText(claim)}</Detail>
      <Detail label="Transport Reason">
        {claim.transport_reason
          ? `${claim.transport_reason} · ${TRANSPORT_REASONS[claim.transport_reason]}`
          : emptyValue}
      </Detail>
      <Detail label="Ambulance Conditions">
        {claim.condition_codes.length ? conditionsText(claim.condition_codes) : emptyValue}
      </Detail>
      <Detail label="Prior Authorization">{authorizationText(claim) ?? emptyValue}</Detail>
      <Detail label="Facility Stay">{stayText(claim) ?? emptyValue}</Detail>
      <Detail label="Patients Transported">{claim.patient_count ?? emptyValue}</Detail>
      <Detail label="Mileage">{milesText(claim) ?? emptyValue}</Detail>
      <Detail label="Weight">{weightText(claim.weight_kg) ?? emptyValue}</Detail>
      <Detail label="On Scene">{formatDateTime(claim.at_scene_at)}</Detail>
      <Detail label="Left Scene">{formatDateTime(claim.left_scene_at)}</Detail>
      <Detail label="At Destination">{formatDateTime(claim.at_destination_at)}</Detail>
    </DetailList>
  </SectionPanel>
);

export const eligibilityStyle = (c: Pick<ClaimCoverage, 'eligibility'>): StatusBadgeStyle =>
  c.eligibility === 'active'
    ? { intent: 'success', label: 'Active' }
    : c.eligibility === 'inactive'
      ? { intent: 'danger', label: 'Not Active' }
      : { label: 'Not Checked' };

export const EligibilityPanel = ({
  coverages,
  locked,
  onCheck,
  onDownload
}: {
  coverages: readonly ClaimCoverage[];
  locked: string | undefined;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
}) => {
  const [busy, setBusy] = useState<'check' | 'download' | null>(null);
  const run = async (which: 'check' | 'download', action: () => Promise<void>) => {
    setBusy(which);
    await action();
    setBusy(null);
  };
  const disabledReason = locked ?? (coverages.length ? undefined : 'The claim has no payers.');
  return (
    <SectionPanel
      title="Eligibility"
      description="Whether each payer says the coverage is active, from the 271 answers of the clearinghouse or uploaded to Payer Files."
      actions={
        <>
          <Button
            variant="outline"
            isPending={busy === 'download'}
            disabledReason={disabledReason}
            onClick={() => void run('download', onDownload)}
          >
            <DownloadIcon aria-hidden="true" className="size-4" />
            Download 270
          </Button>
          <Button
            variant="outline"
            isPending={busy === 'check'}
            disabledReason={disabledReason}
            onClick={() => void run('check', onCheck)}
          >
            <ShieldCheckIcon aria-hidden="true" className="size-4" />
            Check Eligibility
          </Button>
        </>
      }
    >
      {coverages.length ? (
        <Table
          label="Eligibility by payer"
          head={[
            { label: 'Payer' },
            { label: 'Status' },
            { label: 'Checked', isSecondary: true },
            { label: 'Details' }
          ]}
        >
          {coverages.map((c) => {
            const style = eligibilityStyle(c);
            return (
              <TableRow key={c.id}>
                <TableCell>{c.payer}</TableCell>
                <TableCell>
                  <Badge intent={style.intent}>{style.label}</Badge>
                </TableCell>
                <TableCell kind="date" isMuted isSecondary>
                  {formatDateTime(c.eligibility_checked_at)}
                </TableCell>
                <TableCell kind="wrap" isMuted={!c.eligibility_note}>
                  {c.eligibility_note ?? emptyValue}
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      ) : (
        <EmptyText>No payer is on this claim.</EmptyText>
      )}
    </SectionPanel>
  );
};
