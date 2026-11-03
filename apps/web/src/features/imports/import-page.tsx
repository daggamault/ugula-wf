import { ActivityIcon } from 'lucide-react';
import { formatCents, formatDateTime } from '../../shared/format.ts';
import { isOnPage, LIST_RELOAD_MS, type Live, useLive } from '../../shared/live.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge, type StatusBadgeStyle } from '../../shared/ui/badge.tsx';
import { ButtonLink } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { OpenLink } from '../../shared/ui/icon-button.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow, type TableSorting } from '../../shared/ui/table.tsx';
import { useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import type { ImportReport, ImportsClient } from './client.ts';
import { importStatus, sourceOf } from './import-history.tsx';

type ImportPageProps = {
  client: ImportsClient;
  live: Live;
  importId: string;
  back?: string;
};

type ReportOutcome = StatusBadgeStyle & { link: { name: string; to: string } | null };

const pcrOf = (r: ImportReport) => r.pcr_number ?? `PCR #${r.position + 1}`;

const claimLink = (r: ImportReport) =>
  r.claim_id ? { name: `claim for ${pcrOf(r)}`, to: `/claims/${r.claim_id}` } : null;

export const reportOutcome = (r: ImportReport): ReportOutcome => {
  if (r.task_id) {
    return {
      intent: r.task_kind === 'fault' ? 'danger' : 'warning',
      label: r.task_kind === 'fault' ? 'Stuck' : 'Waiting',
      link: claimLink(r) ?? {
        name: `task ${r.task_subject ?? r.task_title ?? pcrOf(r)}`,
        to: `/tasks/${r.task_id}`
      }
    };
  }
  if (r.claim_id) {
    return r.claim_status === 'void'
      ? { label: 'Void', link: claimLink(r) }
      : { intent: 'success', label: 'Claim Opened', link: claimLink(r) };
  }
  switch (r.run_status) {
    case 'completed':
      return { label: 'No Claim', link: null };
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

const REPORT_TABLE = {
  prefix: 'pcr',
  sorts: { position: 'asc', pcr: 'asc', patient: 'asc', status: 'asc', total: 'desc' },
  sort: 'position'
} as const;

export const ReportsTable = ({
  reports,
  sorting
}: {
  reports: readonly ImportReport[];
  sorting?: TableSorting;
}) => (
  <Table
    label="PCRs in this file"
    {...(sorting ? { sorting } : {})}
    head={[
      { label: '#', isCompact: true, sort: 'position' },
      { label: 'PCR', sort: 'pcr' },
      { label: 'Patient', sort: 'patient' },
      { label: 'Outcome', sort: 'status' },
      { label: 'Charges', sort: 'total' },
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
            {outcome.link ? <OpenLink to={outcome.link.to} name={outcome.link.name} /> : null}
          </TableCell>
        </TableRow>
      );
    })}
  </Table>
);

const ImportReports = ({
  client,
  live,
  importId,
  runId
}: Omit<ImportPageProps, 'back'> & { runId: string }) => {
  const table = useTableState(`/imports/${importId}`, REPORT_TABLE);
  const reports = useResource(`import-reports:${importId}:${table.apiQuery}`, (signal) =>
    client.reports(importId, table.apiQuery, signal)
  );
  const items = reports.data?.items ?? [];
  useLive(
    live,
    (e) =>
      (e.kind === 'claim' &&
        isOnPage(
          e.id,
          table.page,
          items.map((r) => r.claim_id)
        )) ||
      (e.kind === 'task' &&
        isOnPage(
          e.id,
          table.page,
          items.map((r) => r.task_id)
        )) ||
      (e.kind === 'run' && (e.id === runId || e.parentId === runId)),
    reports.reload,
    LIST_RELOAD_MS
  );
  return reports.error ? (
    <Alert>{reports.error.message}</Alert>
  ) : items.length && reports.data ? (
    <>
      <ReportsTable reports={items} sorting={table} />
      <Pagination label="PCRs" total={reports.data.total} state={table} />
    </>
  ) : reports.loading ? (
    <PageLoading />
  ) : (
    <EmptyText>No PCRs have been read from this file yet.</EmptyText>
  );
};

export const ImportPage = ({ client, live, importId, back = '/imports' }: ImportPageProps) => {
  const found = useResource(`import:${importId}`, (signal) => client.find(importId, signal));
  const runId = found.data?.run_id;
  useLive(
    live,
    (e) =>
      (e.kind === 'import' && (e.id === null || e.id === importId)) ||
      (e.kind === 'run' && (e.id === runId || e.parentId === runId)),
    found.reload
  );
  if (found.error) return <PageFailure message={found.error.message} />;
  if (!found.data) return <PageLoading />;
  const file = found.data;
  const status = importStatus(file);
  return (
    <Page
      title={file.file_name}
      backTo={back}
      backLabel="Back to Imports"
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge intent={status.intent}>{status.label}</Badge>
          <span>
            {sourceOf(file)} · {formatDateTime(file.created_at)}
            {file.uploaded_by_email ? ` · ${file.uploaded_by_email}` : ''}
          </span>
        </span>
      }
      actions={
        <ButtonLink to={`/runs/${file.run_id}`} variant="outline">
          <ActivityIcon aria-hidden="true" className="size-4" />
          Open Run
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
          <Detail label="Claims Opened" isEmphasized>
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
        <ImportReports client={client} live={live} importId={importId} runId={file.run_id} />
      </SectionPanel>
    </Page>
  );
};
