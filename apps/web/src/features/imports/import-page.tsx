import { ActivityIcon } from 'lucide-react';
import { formatCents, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportReport, ImportsClient } from './client.ts';
import { importStatus } from './import-history.tsx';

export type ImportPageProps = {
  client: ImportsClient;
  live: Live;
  importId: string;
};

export type ReportOutcome = StatusBadgeStyle & { link: { label: string; to: string } | null };

export const reportOutcome = (r: ImportReport): ReportOutcome => {
  if (r.task_id) {
    return {
      intent: r.task_kind === 'fault' ? 'danger' : 'warning',
      label: r.task_kind === 'fault' ? 'Stuck' : 'Waiting on a person',
      link: { label: r.task_title ?? 'Open task', to: `/tasks/${r.task_id}` }
    };
  }
  if (r.claim_id) {
    return {
      intent: 'success',
      label: 'Claim opened',
      link: { label: 'Open claim', to: `/claims/${r.claim_id}` }
    };
  }
  switch (r.run_status) {
    case 'completed':
      return { label: 'No claim', link: null };
    case 'failed':
    case 'cancelled':
      return { intent: 'danger', label: 'Failed', link: null };
    case 'faulted':
      return { intent: 'danger', label: 'Stuck', link: null };
    default:
      return { intent: 'info', label: 'Processing', link: null };
  }
};

export const patientOf = (r: ImportReport) =>
  r.last_name ? `${r.last_name}, ${r.first_name ?? ''}` : (r.task_subject ?? null);

export const ReportsTable = ({ reports }: { reports: readonly ImportReport[] }) => (
  <Table
    label="Reports in this file"
    head={[
      { label: '#', isCompact: true },
      'PCR',
      'Patient',
      'Outcome',
      { label: 'Charges', isNumeric: true },
      { label: 'Next', isLabelHidden: true }
    ]}
  >
    {reports.map((r) => {
      const outcome = reportOutcome(r);
      return (
        <TableRow key={r.id}>
          <TableCell isMuted>{r.position + 1}</TableCell>
          <TableCell>{r.pcr_number ?? emptyValue}</TableCell>
          <TableCell kind="wrap">{patientOf(r) ?? emptyValue}</TableCell>
          <TableCell>
            <Badge intent={outcome.intent}>{outcome.label}</Badge>
          </TableCell>
          <TableCell kind="numeric">
            {r.total_cents === null ? emptyValue : formatCents(r.total_cents)}
          </TableCell>
          <TableCell kind="wrap">
            {outcome.link ? <TextLink to={outcome.link.to}>{outcome.link.label}</TextLink> : null}
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

const SOURCES = { upload: 'Upload', sftp: 'SFTP', manual: 'Workflow run' } as const;

export const ImportPage = ({ client, live, importId }: ImportPageProps) => {
  const found = useResource(`import:${importId}`, () => client.find(importId));
  const runId = found.data?.import.run_id;
  useLive(
    live,
    (e) =>
      e.kind === 'claim' ||
      e.kind === 'task' ||
      (e.kind === 'run' && (e.id === runId || e.parentId === runId)),
    found.reload
  );
  if (found.error) return <PageFailure message={found.error.message} />;
  if (!found.data) return <PageLoading />;
  const { import: file, reports } = found.data;
  const status = importStatus(file);
  return (
    <Page
      title={file.file_name}
      backTo="/imports"
      backLabel="Back to Imports"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge intent={status.intent}>{status.label}</Badge>
          <span>
            {SOURCES[file.source]} · {formatDateTime(file.created_at)}
            {file.uploaded_by_email ? ` · ${file.uploaded_by_email}` : ''}
          </span>
        </span>
      }
      actions={
        <ButtonLink to={`/runs/${file.run_id}`} variant="outline" size="sm">
          <ActivityIcon aria-hidden="true" className="size-4" />
          Open the import run
        </ButtonLink>
      }
    >
      {file.run_status === 'failed' ? (
        <Alert>The file could not be read. Open the import run to see why.</Alert>
      ) : null}
      <SectionPanel title="Summary">
        <DetailList>
          <Detail label="Reports" isEmphasized>
            {file.report_count ?? emptyValue}
          </Detail>
          <Detail label="Claims opened" isEmphasized>
            {file.claims}
          </Detail>
          <Detail label="Charges">{formatCents(file.charges_cents)}</Detail>
          <Detail label="Waiting on a person">{file.waiting}</Detail>
        </DetailList>
      </SectionPanel>
      <SectionPanel
        title="Reports"
        description="Each patient care report in the file and what it became."
      >
        {reports.length ? (
          <ReportsTable reports={reports} />
        ) : (
          <EmptyText>No reports have been read from this file yet.</EmptyText>
        )}
      </SectionPanel>
    </Page>
  );
};
