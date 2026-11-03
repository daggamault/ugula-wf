import { formatCents, formatDateTime } from '../../shared/format.ts';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { runStatusStyles } from '../../shared/ui/run-status-badge.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { withBack } from '../../shared/url-state.ts';
import type { ImportSummary } from './client.ts';

const REPORTS_PENDING: StatusBadgeStyle = { intent: 'info', label: 'PCRs in Progress' };

export const importStatus = (i: ImportSummary) =>
  i.run_status === 'completed' && i.waiting + i.processing + i.stuck > 0
    ? REPORTS_PENDING
    : runStatusStyles[i.run_status];

export const SOURCES: Readonly<Record<ImportSummary['source'], string>> = {
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

export const ImportHistory = ({
  imports,
  sorting,
  back = ''
}: {
  imports: readonly ImportSummary[];
  sorting?: TableSorting;
  /** The list as it is now, so an opened import can return to it. */
  back?: string;
}) => (
  <Table
    label="Imports"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'File', sort: 'file' },
      { label: 'Received', isSecondary: true, sort: 'received' },
      { label: 'Status', sort: 'status' },
      { label: 'PCRs', isNumeric: true, sort: 'reports' },
      { label: 'Claims', isNumeric: true, sort: 'claims' },
      { label: 'Charges', isNumeric: true, isSecondary: true, sort: 'charges' },
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
              <span className="font-medium">{i.file_name}</span>
              <span className="text-surface-fg-muted text-xs">
                {SOURCES[i.source]}
                {i.uploaded_by_email ? ` · ${i.uploaded_by_email}` : ''}
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
            <OpenLink to={withBack(`/imports/${i.id}`, back)} name={`import ${i.file_name}`} />
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);
