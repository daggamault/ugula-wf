import { ChevronRightIcon } from 'lucide-react';
import { formatCents, formatDateTime } from '../../shared/format.ts';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { runStatusStyles } from '../../shared/ui/run-status-badge.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import type { ImportSummary } from './client.ts';

const REPORTS_PENDING: StatusBadgeStyle = { intent: 'info', label: 'PCRs in progress' };

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
  sorts: { received: 'desc', file: 'asc', reports: 'desc', claims: 'desc', charges: 'desc' },
  sort: 'received'
} as const;

export const ImportHistory = ({
  imports,
  sorting
}: {
  imports: readonly ImportSummary[];
  sorting?: TableSorting;
}) => (
  <Table
    label="Imports"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: 'File', sort: 'file' },
      { label: 'Received', isSecondary: true, sort: 'received' },
      'Status',
      { label: 'PCRs', isNumeric: true, sort: 'reports' },
      { label: 'Claims', isNumeric: true, sort: 'claims' },
      { label: 'Charges', isNumeric: true, isSecondary: true, sort: 'charges' },
      'Needs Attention',
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
            <IconLink
              to={`/imports/${i.id}`}
              label={`Open import ${i.file_name}`}
              icon={ChevronRightIcon}
            />
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);
