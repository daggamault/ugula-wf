import { DownloadIcon } from 'lucide-react';
import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { useLocation } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Badge } from '../../shared/ui/badge.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { type SearchField, SearchForm } from '../../shared/ui/search-form.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useResource } from '../../shared/use-resource.ts';
import {
  type RemittanceReport,
  type ReportRemittance,
  type ReportsClient,
  reportQuery,
  type UnmatchedPayment
} from './client.ts';
import { downloadCsv, toCsv } from './csv.ts';

export const REMITTANCE_REPORT_PATH = '/reports/remittances';

const FIELDS: readonly SearchField[] = [
  { name: 'from', label: 'Paid From', type: 'date' },
  { name: 'to', label: 'Paid Through', type: 'date' },
  { name: 'payer', label: 'Payer', placeholder: 'Any payer' }
];

const dollars = (cents: number) => (cents / 100).toFixed(2);

export const stateOf = (
  r: Pick<ReportRemittance, 'reconciled_at' | 'is_balanced' | 'unmatched_count'>
) =>
  r.reconciled_at
    ? 'Reconciled'
    : !r.is_balanced || r.unmatched_count
      ? 'Needs Reconciling'
      : 'Open';

const STATE_INTENTS = {
  Reconciled: 'success',
  'Needs Reconciling': 'warning',
  Open: 'info'
} as const;

export const remittancesCsv = (report: RemittanceReport) =>
  toCsv(
    [
      'Paid',
      'Payer',
      'Trace Number',
      'Method',
      'Amount',
      'Claim Payments',
      'Provider Adjustments',
      'Claims',
      'Unmatched',
      'Balances',
      'State'
    ],
    report.remittances.map((r) => [
      r.paid_on,
      r.payer_name,
      r.trace_number,
      r.payment_method,
      dollars(r.total_cents),
      dollars(r.claim_paid_cents),
      dollars(r.provider_adjustment_cents),
      r.payment_count,
      r.unmatched_count,
      r.is_balanced ? 'Yes' : 'No',
      stateOf(r)
    ])
  );

const SummaryPanel = ({ report }: { report: RemittanceReport }) => (
  <SectionPanel title="Summary">
    <DetailList>
      <Detail label="Deposited" isEmphasized>
        {formatCents(report.totals.totalCents)}
      </Detail>
      <Detail label="Remittances">{report.totals.remittances}</Detail>
      <Detail label="Claim Payments">{formatCents(report.totals.claimPaidCents)}</Detail>
      <Detail label="Provider Adjustments">
        {formatCents(report.totals.providerAdjustmentCents)}
      </Detail>
      <Detail label="Not Reconciled">{report.totals.open}</Detail>
      <Detail label="Do Not Balance">{report.totals.unbalanced}</Detail>
      <Detail label="Unmatched Payments">{report.totals.unmatched}</Detail>
    </DetailList>
  </SectionPanel>
);

export const RemittancesTable = ({ rows }: { rows: readonly ReportRemittance[] }) =>
  rows.length ? (
    <Table
      label="Remittances"
      head={['Paid', 'Payer', 'Amount', 'Claim Payments', 'Adjustments', 'Claims', 'State']}
    >
      {rows.map((r) => {
        const state = stateOf(r);
        return (
          <TableRow key={r.id}>
            <TableCell kind="date">{formatDate(r.paid_on)}</TableCell>
            <TableCell>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{r.payer_name ?? 'Unknown payer'}</span>
                <span className="text-surface-fg-muted text-xs">
                  {[r.trace_number, r.payment_method].filter(Boolean).join(' · ') || emptyValue}
                </span>
              </span>
            </TableCell>
            <TableCell kind="numeric">{formatCents(r.total_cents)}</TableCell>
            <TableCell kind="numeric">{formatCents(r.claim_paid_cents)}</TableCell>
            <TableCell kind="numeric">{formatCents(r.provider_adjustment_cents)}</TableCell>
            <TableCell kind="numeric">
              {r.payment_count}
              {r.unmatched_count ? (
                <span className="text-warning-text text-xs"> ({r.unmatched_count} unmatched)</span>
              ) : null}
            </TableCell>
            <TableCell>
              <Badge intent={STATE_INTENTS[state]}>{state}</Badge>
            </TableCell>
          </TableRow>
        );
      })}
    </Table>
  ) : (
    <EmptyText>No remittances were paid in this period.</EmptyText>
  );

export const UnmatchedTable = ({ rows }: { rows: readonly UnmatchedPayment[] }) =>
  rows.length ? (
    <Table
      label="Unmatched Payments"
      head={['Paid', 'Payer', 'Claim Number', 'Charged', 'Paid', 'Patient Owes']}
    >
      {rows.map((p) => (
        <TableRow key={p.id}>
          <TableCell kind="date">{formatDate(p.paid_on)}</TableCell>
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{p.payer_name ?? 'Unknown payer'}</span>
              <span className="text-surface-fg-muted text-xs">{p.trace_number ?? emptyValue}</span>
            </span>
          </TableCell>
          <TableCell>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono">{p.claim_number}</span>
              {p.payer_claim_number ? (
                <span className="text-surface-fg-muted text-xs">
                  Payer claim {p.payer_claim_number}
                </span>
              ) : null}
            </span>
          </TableCell>
          <TableCell kind="numeric">{formatCents(p.charge_cents)}</TableCell>
          <TableCell kind="numeric">{formatCents(p.paid_cents)}</TableCell>
          <TableCell kind="numeric">{formatCents(p.patient_cents)}</TableCell>
        </TableRow>
      ))}
    </Table>
  ) : (
    <EmptyText>Every payment in this period matched a claim.</EmptyText>
  );

export const RemittanceReportView = ({ report }: { report: RemittanceReport }) => (
  <>
    {report.truncated ? (
      <Alert intent="warning">
        This period has more remittances than the report shows; choose a shorter period.
      </Alert>
    ) : null}
    <SummaryPanel report={report} />
    <SectionPanel title="Remittances">
      <RemittancesTable rows={report.remittances} />
    </SectionPanel>
    <SectionPanel title="Unmatched Payments">
      <UnmatchedTable rows={report.unmatched} />
    </SectionPanel>
  </>
);

export const RemittanceReportPage = ({ client, live }: { client: ReportsClient; live: Live }) => {
  const { query } = useLocation();
  const asked = reportQuery(query);
  const report = useResource(`report:remittances:${asked}`, (signal) =>
    client.remittances(asked, signal)
  );
  useReconnect(live, report.reload);
  const data = report.data;
  return (
    <Page
      title="Remittances"
      backTo="/reports"
      backLabel="Back to Reports"
      description={
        data
          ? `Paid ${formatDate(data.period.from)} through ${formatDate(data.period.to)}`
          : undefined
      }
      actions={
        data ? (
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                `remittances-${data.period.from}-${data.period.to}.csv`,
                remittancesCsv(data)
              )
            }
          >
            <DownloadIcon aria-hidden="true" className="size-4" />
            Download CSV
          </Button>
        ) : null
      }
    >
      <SearchForm label="Report Period" path={REMITTANCE_REPORT_PATH} fields={FIELDS} />
      {report.error ? (
        <Alert>{report.error.message}</Alert>
      ) : data ? (
        <RemittanceReportView report={data} />
      ) : (
        <PageLoading />
      )}
    </Page>
  );
};
