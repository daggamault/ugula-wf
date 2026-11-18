import { formatDateTime } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimDetail } from './claim-detail.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';

type Reviewed = Pick<
  ClaimDetail,
  | 'status'
  | 'revision'
  | 'reviewed_at'
  | 'reviewed_by'
  | 'review_note'
  | 'status_note'
  | 'sent_at'
  | 'sent_file_name'
  | 'sent_control_number'
>;

export const ClaimReviewPanel = ({ claim }: { claim: Reviewed }) => (
  <SectionPanel title="Review">
    <DetailList>
      <Detail label="Status">
        <ClaimStatusBadge status={claim.status} />
      </Detail>
      <Detail label="Revision">{claim.revision}</Detail>
      {claim.status === 'needs_review' ? (
        <Detail label="Waiting For">
          A biller to approve it for the clearinghouse or put it on hold
        </Detail>
      ) : (
        <>
          <Detail label={claim.status === 'on_hold' ? 'Held By' : 'Approved By'}>
            {claim.reviewed_by ?? emptyValue}
          </Detail>
          <Detail label="Reviewed">{formatDateTime(claim.reviewed_at)}</Detail>
          <Detail label="Note">{claim.review_note ?? emptyValue}</Detail>
        </>
      )}
      {claim.status_note ? <Detail label="Settled Because">{claim.status_note}</Detail> : null}
      {claim.sent_at ? (
        <>
          <Detail label="Sent">{formatDateTime(claim.sent_at)}</Detail>
          <Detail label="837P File">
            {claim.sent_file_name}
            <span className="text-surface-fg-muted text-xs tabular-nums">
              {' '}
              control {claim.sent_control_number}
            </span>
          </Detail>
        </>
      ) : null}
    </DetailList>
  </SectionPanel>
);
