import { ActivityIcon, ChevronRightIcon } from 'lucide-react';
import { formatCents, formatDateTime } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportReport, ImportsClient } from './client.ts';
import { importStatus, SOURCES } from './import-history.tsx';

export type ImportPageProps = {
  client: ImportsClient;
  live: Live;
  importId: string;
};

export type ReportOutcome = StatusBadgeStyle & { link: { label: string; to: string } | null };

const pcrOf = (r: ImportReport) => r.pcr_number ?? `PCR #${r.position + 1}`;

export const reportOutcome = (r: ImportReport): ReportOutcome => {
  if (r.task_id) {
    return {
      intent: r.task_kind === 'fault' ? 'danger' : 'warning',
      label: r.task_kind === 'fault' ? 'Stuck' : 'Waiting',
      link: {
        label: `Open task ${r.task_subject ?? r.task_title ?? pcrOf(r)}`,
        to: `/tasks/${r.task_id}`
      }
    };
  }
  if (r.claim_id) {
    return {
      intent: 'success',
      label: 'Claim opened',
      link: { label: `Open claim for ${pcrOf(r)}`, to: `/claims/${r.claim_id}` }
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
      return { intent: 'info', label: 'Running', link: null };
  }
};

export const patientOf = (r: ImportReport) =>
  r.last_name ? `${r.last_name}, ${r.first_name ?? ''}` : (r.task_subject ?? null);

export const ReportsTable = ({ reports }: { reports: readonly ImportReport[] }) => (
  <Table
    label="PCRs in this file"
    head={[
      { label: '#', isCompact: true },
      'PCR',
      'Patient',
      'Outcome',
      { label: 'Charges', isNumeric: true },
      { label: 'Actions', isLabelHidden: true, isCompact: true }
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
          <TableCell kind="actions">
            {outcome.link ? (
              <IconLink to={outcome.link.to} label={outcome.link.label} icon={ChevronRightIcon} />
            ) : null}
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

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
        <ButtonLink to={`/runs/${file.run_id}`} variant="outline">
          <ActivityIcon aria-hidden="true" className="size-4" />
          Open run
        </ButtonLink>
      }
    >
      {file.run_status === 'failed' ? (
        <Alert>The file could not be read. Open its run to see why.</Alert>
      ) : null}
      <SectionPanel title="Summary" description="What this file has become so far.">
        <DetailList>
          <Detail label="PCRs" isEmphasized>
            {file.report_count ?? emptyValue}
          </Detail>
          <Detail label="Claims opened" isEmphasized>
            {file.claims}
          </Detail>
          <Detail label="Charges">{formatCents(file.charges_cents)}</Detail>
          <Detail label="Waiting">{file.waiting}</Detail>
        </DetailList>
      </SectionPanel>
      <SectionPanel
        title="PCRs"
        description="Each patient care report (PCR) in the file and what it became."
      >
        {reports.length ? (
          <ReportsTable reports={reports} />
        ) : (
          <EmptyText>No PCRs have been read from this file yet.</EmptyText>
        )}
      </SectionPanel>
    </Page>
  );
};
