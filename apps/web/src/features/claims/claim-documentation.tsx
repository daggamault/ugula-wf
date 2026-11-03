import {
  AMBULANCE_CONDITIONS,
  poundsOf,
  SIGNATURE_LABELS,
  TRANSPORT_REASONS
} from '@ugula/billing';
import { ShieldCheckIcon } from 'lucide-react';
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
    description="What the report documents for billing: signature, physician certification, transport reason and trip times."
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
      <Detail label="Physician Certification">{pcsText(claim)}</Detail>
      <Detail label="Transport Reason">
        {claim.transport_reason
          ? `${claim.transport_reason} · ${TRANSPORT_REASONS[claim.transport_reason]}`
          : emptyValue}
      </Detail>
      <Detail label="Ambulance Conditions">
        {claim.condition_codes.length ? conditionsText(claim.condition_codes) : emptyValue}
      </Detail>
      <Detail label="Prior Authorization">{claim.prior_authorization ?? emptyValue}</Detail>
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
  onCheck
}: {
  coverages: readonly ClaimCoverage[];
  locked: string | undefined;
  onCheck: () => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    await onCheck();
    setBusy(false);
  };
  return (
    <SectionPanel
      title="Eligibility"
      description="Whether each payer says the coverage is active, from the 271 responses uploaded to Payer Files."
      actions={
        <Button
          variant="outline"
          isPending={busy}
          disabledReason={locked ?? (coverages.length ? undefined : 'The claim has no payers.')}
          onClick={() => void check()}
        >
          <ShieldCheckIcon aria-hidden="true" className="size-4" />
          Check Eligibility
        </Button>
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
