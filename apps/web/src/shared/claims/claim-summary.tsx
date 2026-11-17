import { CLASSIFICATION_LABELS } from '@ugula/billing';
import { formatCents, formatMiles } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimDetail } from './claim-detail.ts';

type Summarized = Pick<
  ClaimDetail,
  'total_cents' | 'classification' | 'level' | 'is_emergency' | 'loaded_miles'
>;

export const ClaimSummaryPanel = ({ claim }: { claim: Summarized }) => (
  <SectionPanel title="Summary">
    <DetailList>
      <Detail label="Total" isEmphasized>
        {formatCents(claim.total_cents)}
      </Detail>
      <Detail label="Classification">{CLASSIFICATION_LABELS[claim.classification]}</Detail>
      <Detail label="Level of Service">
        {claim.level ?? emptyValue}
        {claim.is_emergency ? ' emergency' : ''}
      </Detail>
      <Detail label="Loaded Miles">
        {claim.loaded_miles ? (
          <span className="tabular-nums">{formatMiles(claim.loaded_miles)}</span>
        ) : (
          emptyValue
        )}
      </Detail>
    </DetailList>
  </SectionPanel>
);

export const ReasonsPanel = ({ reasons }: { reasons: readonly string[] }) => (
  <SectionPanel title="Reasons">
    {reasons.length ? (
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    ) : (
      <EmptyText>The workflow gave no reasons for this claim.</EmptyText>
    )}
  </SectionPanel>
);
