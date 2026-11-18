import { formatCents, formatDateTime } from '../../shared/format.ts';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { runStatusStyles } from '../../shared/ui/run-status-badge.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, withBack } from '../../shared/url-state.ts';
import type { ImportSummary } from './client.ts';

const WAITING: StatusBadgeStyle = { intent: 'info', label: 'Waiting to Be Read' };

export const importStatus = (i: Pick<ImportSummary, 'run_status'>) =>
  i.run_status ? runStatusStyles[i.run_status] : WAITING;

const SOURCES: Readonly<Record<ImportSummary['source'], string>> = {
  upload: 'Upload',
  sftp: 'SFTP',
  manual: 'Workflow Run'
};

export const reportOutcomes = (i: Pick<ImportSummary, 'created' | 'revised' | 'unchanged'>) =>
  [
    i.created ? `${i.created} new` : '',
    i.revised ? `${i.revised} revised` : '',
    i.unchanged ? `${i.unchanged} unchanged` : ''
  ].filter(Boolean);

export const IMPORT_TABLE = {
  sorts: {
    received: 'desc',
    file: 'asc',
    reports: 'desc',
    claims: 'desc',
    charges: 'desc',
    status: 'asc'
  },
  sort: 'received'
} as const;

export const sourceOf = (i: Pick<ImportSummary, 'source'>) => SOURCES[i.source];

export const ImportHistory = ({
  imports,
  search
}: {
  imports: readonly ImportSummary[];
  search?: SearchView;
}) => (
  <Table
    label="Imports"
    {...(search ? { sorting: search } : {})}
    head={[
      { label: 'File', sort: 'file' },
      { label: 'Received', isSecondary: true, sort: 'received' },
      { label: 'Status', sort: 'status' },
      { label: 'PCRs', sort: 'reports' },
      { label: 'Claims', sort: 'claims' },
      { label: 'Charges', isSecondary: true, sort: 'charges' },
      { label: 'Encounters' },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
    ]}
  >
    {imports.map((i) => {
      const outcomes = reportOutcomes(i);
      const status = importStatus(i);
      return (
        <TableRow key={i.id}>
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                <Highlight text={i.file_name} query={search?.q ?? ''} />
              </span>
              <span className="text-surface-fg-muted text-xs">
                {sourceOf(i)}
                {i.uploaded_by_email ? (
                  <>
                    {' · '}
                    <Highlight text={i.uploaded_by_email} query={search?.q ?? ''} />
                  </>
                ) : null}
              </span>
            </span>
          </TableCell>
          <TableCell kind="date" isMuted isSecondary>
            {formatDateTime(i.created_at)}
          </TableCell>
          <TableCell>
            <Badge intent={status.intent}>{status.label}</Badge>
          </TableCell>
          <TableCell kind="numeric">{i.report_count ?? emptyValue}</TableCell>
          <TableCell kind="numeric">{i.claims}</TableCell>
          <TableCell kind="numeric" isSecondary>
            {formatCents(i.charges_cents)}
          </TableCell>
          <TableCell isMuted={!outcomes.length}>
            {outcomes.length ? outcomes.join(', ') : 'None yet'}
          </TableCell>
          <TableCell kind="actions">
            <OpenLink
              to={withBack(`/imports/${i.id}`, search?.href ?? '')}
              name={`import ${i.file_name}`}
            />
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);
