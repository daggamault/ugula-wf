import { isClosedStatus } from '@ugula/billing';
import { ChargeLines } from '../../shared/claims/charge-lines.tsx';
import { ClaimDataView } from '../../shared/claims/claim-data.tsx';
import { DocumentationPanel } from '../../shared/claims/claim-documentation.tsx';
import { ClaimIssues } from '../../shared/claims/claim-issues.tsx';
import { PayersPanel } from '../../shared/claims/claim-payers.tsx';
import { ClaimSummaryPanel, pricedLinesOf } from '../../shared/claims/claim-summary.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import type { TaskClaimRecord } from './client.ts';
import type { Mismatch } from './encounter-check.ts';
import { MismatchAlert } from './task-brief.tsx';

export const TaskClaimView = ({
  record: { claim, codes, issues },
  mismatches = [],
  encounterHref
}: {
  record: TaskClaimRecord;
  mismatches?: readonly Mismatch[];
  encounterHref?: string | undefined;
}) => (
  <>
    <MismatchAlert mismatches={mismatches} encounterHref={encounterHref} />
    {isClosedStatus(claim.status) ? null : <ClaimIssues issues={issues} />}
    <ClaimSummaryPanel claim={claim} />
    <SectionPanel title="Charges" description="Priced from the fee schedule.">
      {claim.lines.length ? (
        <ChargeLines lines={pricedLinesOf(claim.lines)} codes={codes} />
      ) : (
        <EmptyText>No charge lines yet.</EmptyText>
      )}
    </SectionPanel>
    <ClaimDataView claim={claim} codes={codes} />
    <DocumentationPanel claim={claim} />
    <PayersPanel coverages={claim.coverages} />
  </>
);
