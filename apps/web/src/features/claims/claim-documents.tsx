import { DOCUMENT_CONTENT_TYPES, DOCUMENT_KINDS, type DocumentKind } from '@ugula/billing';
import { DownloadIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid, FieldGroup, FieldGroups } from '../../shared/ui/field.tsx';
import { FileButton } from '../../shared/ui/file-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import type { ClaimDocument } from './client.ts';

const KIND_OPTIONS = Object.entries(DOCUMENT_KINDS).map(([value, label]) => ({ value, label }));

const linkClasses = classNamesOf(
  interactiveClasses,
  'text-primary inline-flex items-center gap-2 rounded-lg font-medium hover:underline'
);

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
  locked,
  documentUrl,
  onUpload,
  onChase
}: {
  documents: readonly ClaimDocument[];
  locked: string | undefined;
  documentUrl: (documentId: string) => string;
  onUpload: (kind: DocumentKind, signedOn: string, file: File) => Promise<boolean>;
  onChase: (kind: DocumentKind, note: string | null) => Promise<boolean>;
}) => {
  const [kind, setKind] = useState<DocumentKind>('pcs');
  const [signedOn, setSignedOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'upload' | 'chase' | null>(null);
  const run = async (which: 'upload' | 'chase', action: () => Promise<boolean>) => {
    setBusy(which);
    if (await action()) {
      setSignedOn('');
      setNote('');
    }
    setBusy(null);
  };
  return (
    <SectionPanel
      title="Documents"
      description="Facesheets, certifications, signature forms, ABNs and MSP forms kept with the claim; each one is read into the claim when it arrives."
    >
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
      <fieldset disabled={Boolean(locked) || busy !== null}>
        <FieldGroups>
          <FieldGroup title="Add or Chase a Document">
            <FieldGrid>
              <Select
                id="document-kind"
                label="Document"
                span={2}
                options={KIND_OPTIONS}
                value={kind}
                onChange={(e) => setKind(e.target.value as DocumentKind)}
              />
              <Input
                id="document-signed-on"
                label="Signed On"
                hint="For a certification or ABN"
                type="date"
                span={2}
                value={signedOn}
                onChange={(e) => setSignedOn(e.target.value)}
              />
              <Input
                id="document-note"
                label="Chase Note"
                hint="Who to ask, for a missing document"
                span={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FieldGrid>
          </FieldGroup>
        </FieldGroups>
        <div className="flex flex-wrap items-center gap-2">
          <FileButton
            label="Upload Document"
            accept={DOCUMENT_CONTENT_TYPES.join(',')}
            busy={busy === 'upload'}
            onFiles={([file]) => {
              if (file) void run('upload', () => onUpload(kind, signedOn, file));
            }}
          />
          <Button
            variant="outline"
            isPending={busy === 'chase'}
            disabledReason={locked}
            onClick={() => void run('chase', () => onChase(kind, note.trim() || null))}
          >
            <SendIcon aria-hidden="true" className="size-4" />
            Chase Document
          </Button>
        </div>
      </fieldset>
    </SectionPanel>
  );
};
