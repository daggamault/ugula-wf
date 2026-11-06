import { DOCUMENT_KINDS } from '@ugula/billing';
import { DownloadIcon } from 'lucide-react';
import type { ClaimDocument } from '../../shared/claims/claim-detail.ts';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { textLinkClasses } from '../../shared/ui/text-link.tsx';

const linkClasses = classNamesOf(textLinkClasses, 'inline-flex items-center gap-2');

export const documentMeta = (
  d: Pick<ClaimDocument, 'signed_on' | 'created_at' | 'uploaded_by_email'>
) =>
  [
    d.signed_on ? `signed ${formatDate(d.signed_on)}` : null,
    `uploaded ${formatDateTime(d.created_at)}${d.uploaded_by_email ? ` by ${d.uploaded_by_email}` : ''}`
  ]
    .filter(Boolean)
    .join(' · ');

export const DocumentsPanel = ({
  documents,
  documentUrl
}: {
  documents: readonly ClaimDocument[];
  documentUrl: (documentId: string) => string;
}) => (
  <SectionPanel title="Documents" description="Each one is read into the claim when it arrives.">
    {documents.length ? (
      <ul className="flex flex-col gap-2 text-sm">
        {documents.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2">
            <a href={documentUrl(d.id)} download className={linkClasses}>
              <DownloadIcon aria-hidden="true" className="size-4" />
              {DOCUMENT_KINDS[d.kind]}: {d.file_name}
            </a>
            <span className="text-surface-fg-muted">{documentMeta(d)}</span>
          </li>
        ))}
      </ul>
    ) : (
      <EmptyText>No documents are on this claim yet.</EmptyText>
    )}
  </SectionPanel>
);
