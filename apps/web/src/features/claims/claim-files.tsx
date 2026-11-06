import { PAYER_FILE_LABELS } from '@ugula/billing';
import { DownloadIcon, FileInputIcon, FileTextIcon } from 'lucide-react';
import type { ClaimDetail, ClaimPayerFile } from '../../shared/claims/claim-detail.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDateTime } from '../../shared/format.ts';
import { OUTCOME_STYLES } from '../../shared/payer-file-outcomes.ts';
import { Link } from '../../shared/router.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { textLinkClasses } from '../../shared/ui/text-link.tsx';
import { withBack } from '../../shared/url-state.ts';
import type { ClaimEvent } from './client.ts';

export const EVENT_LABELS: Record<ClaimEvent['kind'], string> = {
  approved: 'Approved for submission',
  submitted: 'Submitted',
  follow_up: 'Followed up',
  resubmitted: 'Resubmitted',
  resubmit_queued: 'Resubmission queued',
  response: 'Response',
  reconciled: 'Payment reconciled',
  payer_skipped: 'Payer skipped',
  statement: 'Patient statement',
  revised: 'Updated PCR received',
  edited: 'Claim data edited',
  refunded: 'Refunded',
  closed: 'Closed',
  accepted: 'Accepted by the payer',
  rejected: 'Rejected',
  eligibility: 'Eligibility checked',
  claim_status: 'Claim status from the payer',
  denied: 'Denied',
  appeal_packet: 'Appeal packet',
  appealed: 'Appeal sent',
  appeal_decided: 'Appeal decided',
  reopening_requested: 'Reopening requested',
  records_requested: 'Records requested',
  records_sent: 'Records sent',
  closing_approved: 'Closing approved',
  balance_protected: 'Balance-billing protection',
  facility_invoiced: 'Facility invoice',
  facility_follow_up: 'Followed up with facility',
  responsibility: 'Responsible party recorded',
  document: 'Document received'
};

export const fileLinkClasses = classNamesOf(
  textLinkClasses,
  'inline-flex items-center gap-2 whitespace-nowrap'
);

export const ClaimFiles = ({
  claim,
  files,
  payerFiles,
  back,
  documentUrl,
  fileUrl,
  encounterUrl
}: {
  claim: Pick<ClaimDetail, 'import_report_id' | 'pcr_number' | 'import_id' | 'import_file_name'>;
  files: readonly ClaimEvent[];
  payerFiles: readonly ClaimPayerFile[];
  back: string;
  documentUrl: (eventId: string) => string;
  fileUrl: (batchId: string) => string;
  encounterUrl: (reportId: string) => string;
}) => {
  const batches = files.filter((e) => e.batch_id);
  const documents = files.filter((e) => e.has_document);
  return (
    <SectionPanel title="Files">
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          {claim.import_report_id ? (
            <>
              <a href={encounterUrl(claim.import_report_id)} download className={fileLinkClasses}>
                <DownloadIcon aria-hidden="true" className="size-4" />
                Encounter {claim.pcr_number ?? ''} (NEMSIS XML)
              </a>
              {claim.import_id ? (
                <span className="text-surface-fg-muted">
                  from{' '}
                  <Link
                    to={withBack(`/imports/${claim.import_id}`, back)}
                    className={textLinkClasses}
                  >
                    {claim.import_file_name}
                  </Link>
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-surface-fg-muted">No source encounter file.</span>
          )}
        </li>
        {batches.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <a href={fileUrl(e.batch_id ?? '')} download className={fileLinkClasses}>
              <DownloadIcon aria-hidden="true" className="size-4" />
              837P File #{e.batch_number}
            </a>
            <span className="text-surface-fg-muted">
              {e.payer} · {formatDateTime(e.created_at)}
            </span>
            {e.batch_sent_at ? (
              <Badge intent="success">Sent {formatDateTime(e.batch_sent_at)}</Badge>
            ) : (
              <Badge intent="warning">Not sent; upload it to the clearinghouse</Badge>
            )}
          </li>
        ))}
        {payerFiles.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2">
            <Link to={withBack(`/payer-files/${f.id}`, back)} className={fileLinkClasses}>
              <FileInputIcon aria-hidden="true" className="size-4" />
              {f.file_name}
            </Link>
            <span className="text-surface-fg-muted">
              {PAYER_FILE_LABELS[f.kind]} · {formatDateTime(f.created_at)}
            </span>
            {f.items.map((i, n) => (
              <span key={`${f.id}-${n}`} className="flex items-center gap-2">
                <Badge intent={OUTCOME_STYLES[i.outcome].intent}>
                  {OUTCOME_STYLES[i.outcome].label}
                </Badge>
                {i.message ? <span className="text-surface-fg-muted">{i.message}</span> : null}
              </span>
            ))}
          </li>
        ))}
        {documents.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <a href={documentUrl(e.id)} target="_blank" rel="noopener" className={fileLinkClasses}>
              <FileTextIcon aria-hidden="true" className="size-4" />
              {e.note || EVENT_LABELS[e.kind]}
            </a>
            <span className="text-surface-fg-muted">{formatDateTime(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
};
