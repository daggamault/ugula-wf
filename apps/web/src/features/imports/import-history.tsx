import { formatCents, formatDateTime } from '../../shared/format.ts';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import type { ImportRunStatus, ImportSummary } from './client.ts';

const STATUS: Record<ImportRunStatus, StatusBadgeStyle> = {
  running: { intent: 'info', label: 'Processing' },
  suspended: { intent: 'warning', label: 'In review' },
  completed: { intent: 'success', label: 'Done' },
  faulted: { intent: 'danger', label: 'Stuck' },
  failed: { intent: 'danger', label: 'Failed' },
  cancelled: { label: 'Cancelled' }
};

const REPORTS_PENDING: StatusBadgeStyle = { intent: 'info', label: 'Reports in progress' };

export const importStatus = (i: ImportSummary) =>
  i.run_status === 'completed' && i.waiting + i.processing + i.stuck > 0
    ? REPORTS_PENDING
    : STATUS[i.run_status];

const SOURCES: Record<ImportSummary['source'], string> = {
  upload: 'Upload',
  sftp: 'SFTP',
  manual: 'Workflow run'
};

export const reportOutcomes = (i: ImportSummary) =>
  [
    i.waiting ? `${i.waiting} in review` : '',
    i.failed ? `${i.failed} failed` : '',
    i.stuck ? `${i.stuck} stuck` : '',
    i.processing ? `${i.processing} processing` : ''
  ].filter(Boolean);

export const ImportHistory = ({ imports }: { imports: readonly ImportSummary[] }) => (
  <Table
    label="Recent imports"
    head={[
      'File',
      { label: 'Received', isSecondary: true },
      'Status',
      { label: 'Reports', isNumeric: true },
      { label: 'Claims', isNumeric: true },
      { label: 'Charges', isNumeric: true, isSecondary: true },
      'Needs attention'
    ]}
  >
    {imports.map((i) => {
      const outcomes = reportOutcomes(i);
      const status = importStatus(i);
      return (
        <TableRow key={i.id}>
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <TextLink to={`/runs/${i.run_id}`}>{i.file_name}</TextLink>
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
        </TableRow>
      );
    })}
  </Table>
);
