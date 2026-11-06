import { CLASSIFICATION_LABELS, type ClaimBilling } from '@ugula/billing';
import { formatCents, formatDate, formatMiles } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimDetail, ClaimLine } from './claim-detail.ts';

export const pricedLinesOf = (lines: readonly ClaimLine[]) =>
  lines.map((l) => ({
    code: l.code,
    units: Number(l.units),
    unitCents: l.unit_cents,
    totalCents: l.total_cents
  }));

export const chargesNote = (billing: ClaimBilling | null) =>
  billing ? `Modifiers as billed to ${billing.payer}.` : undefined;

export const ClaimSummaryPanel = ({ claim }: { claim: ClaimDetail }) => (
  <SectionPanel title="Summary">
    <DetailList>
      <Detail label="Total" isEmphasized>
        {formatCents(claim.total_cents)}
      </Detail>
      <Detail label="Balance" isEmphasized>
        {formatCents(claim.balance_cents)}
      </Detail>
      <Detail label="Service Date">{formatDate(claim.service_date)}</Detail>
      <Detail label="Born">{formatDate(claim.birth_date)}</Detail>
      <Detail label="Classification">
        {claim.classification ? CLASSIFICATION_LABELS[claim.classification] : emptyValue}
      </Detail>
      <Detail label="Transport">
        {claim.level ?? emptyValue}
        {claim.emergency ? ' emergency' : ''}
        {claim.loaded_miles ? (
          <span className="tabular-nums"> · {formatMiles(claim.loaded_miles)} loaded</span>
        ) : null}
      </Detail>
      <Detail label="Responsible Facility">
        {claim.facility_name ?? 'None: the payers and the patient'}
      </Detail>
    </DetailList>
  </SectionPanel>
);
