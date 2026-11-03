import { formatCents, formatDateTime } from '../../shared/format.ts';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Highlight } from '../../shared/ui/highlight.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { runStatusStyles } from '../../shared/ui/run-status-badge.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { type SearchView, withBack } from '../../shared/url-state.ts';
import type { ImportSummary } from './client.ts';

const REPORTS_PENDING: StatusBadgeStyle = { intent: 'info', label: 'PCRs in Progress' };

export const importStatus = (i: ImportSummary) =>
  i.run_status === 'completed' && i.waiting + i.processing + i.stuck > 0
    ? REPORTS_PENDING
    : runStatusStyles[i.run_status];

const SOURCES: Readonly<Record<ImportSummary['source'], string>> = {
  upload: 'Upload',
  sftp: 'SFTP',
  manual: 'Workflow run'
};

export const reportOutcomes = (i: ImportSummary) =>
  [
    i.waiting ? `${i.waiting} waiting` : '',
    i.failed ? `${i.failed} failed` : '',
    i.stuck ? `${i.stuck} stuck` : '',
    i.processing ? `${i.processing} running` : ''
  ].filter(Boolean);

export const IMPORT_TABLE = {
  sorts: {
    received: 'desc',
    file: 'asc',
    reports: 'desc',
    claims: 'desc',
    charges: 'desc',
    status: 'asc',
    attention: 'desc'
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
      { label: 'Needs Attention', sort: 'attention' },
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
            {outcomes.length ? outcomes.join(', ') : 'Nothing'}
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
