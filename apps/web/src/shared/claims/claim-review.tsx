import { formatDateTime } from '../format.ts';
import { Detail, DetailList } from '../ui/detail-list.tsx';
import { emptyValue } from '../ui/empty-state.tsx';
import { SectionPanel } from '../ui/section-panel.tsx';
import type { ClaimDetail } from './claim-detail.ts';
import { ClaimStatusBadge } from './claim-status-badge.tsx';

type Reviewed = Pick<
  ClaimDetail,
  'status' | 'revision' | 'reviewed_at' | 'reviewed_by' | 'review_note'
>;

const DECIDED = { approved: 'Approved By', on_hold: 'Held By' } as const;

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
          <Detail label={DECIDED[claim.status]}>{claim.reviewed_by ?? emptyValue}</Detail>
          <Detail label="Reviewed">{formatDateTime(claim.reviewed_at)}</Detail>
          <Detail label="Note">{claim.review_note ?? emptyValue}</Detail>
        </>
      )}
    </DetailList>
  </SectionPanel>
);
