import { DownloadIcon, PlayIcon, PrinterIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { IconLink } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { hrefWith } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { type AnyReport, findReport, REPORTS } from './catalog.ts';
import type { DateRange, ReportsClient } from './client.ts';
import { downloadCsv } from './csv.ts';
import { csvRows, totalsOf } from './report-columns.ts';
import { ReportDocument } from './report-document.tsx';

export const REPORT_PAGE_SIZE = 100;

const day = (d: Date) => d.toISOString().slice(0, 10);

export const defaultRange = (now: Date): DateRange => {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from: day(from), to: day(now) };
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const rangeOf = (query: URLSearchParams, now: Date): DateRange => {
  const fallback = defaultRange(now);
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  return {
    from: ISO_DAY.test(from) ? from : fallback.from,
    to: ISO_DAY.test(to) ? to : fallback.to
  };
};

const withRange = (path: string, r: Pick<AnyReport, 'usesPeriod'>, range: DateRange) =>
  hrefWith(path, new URLSearchParams(), {
    from: r.usesPeriod ? range.from : null,
    to: r.usesPeriod ? range.to : null
  });

export const optionsPath = (r: Pick<AnyReport, 'id' | 'usesPeriod'>, range: DateRange) =>
  withRange(`/reports/${r.id}`, r, range);

export const resultsPath = (r: Pick<AnyReport, 'id' | 'usesPeriod'>, range: DateRange) =>
  withRange(`/reports/${r.id}/results`, r, range);

export const pageParam = (query: URLSearchParams) => {
  const n = Number(query.get('page'));
  return Number.isInteger(n) && n > 1 ? n : 1;
};

export const periodText = (r: Pick<AnyReport, 'usesPeriod'>, range: DateRange, now: Date) =>
  r.usesPeriod
    ? `Dates of service ${formatDate(range.from)} to ${formatDate(range.to)}`
    : `Open balances as of ${formatDate(day(now))}`;

export const ReportsPage = () => (
  <Page
    title="Reports"
    description="Receivables, collections and payer performance, straight from your claims."
  >
    <Table
      label="Reports"
      head={['Report', 'Description', { label: 'Actions', isLabelHidden: true, isCompact: true }]}
    >
      {REPORTS.map((r) => (
        <TableRow key={r.id}>
          <TableCell>
            <span className="font-semibold">{r.title}</span>
          </TableCell>
          <TableCell kind="wrap" isMuted>
            {r.description}
          </TableCell>
          <TableCell kind="actions">
            <IconLink to={`/reports/${r.id}`} label={`Run ${r.title}`} icon={PlayIcon} />
          </TableCell>
        </TableRow>
      ))}
    </Table>
  </Page>
);

export type ReportPageProps = {
  reportId: string;
  query: URLSearchParams;
  now?: Date;
};

const unknownReport = (id: string) => (
  <PageFailure message={`There is no report called “${id}”.`} />
);

export const ReportOptionsPage = ({ reportId, query, now = new Date() }: ReportPageProps) => {
  const report = findReport(reportId);
  const [draft, setDraft] = useState(() => rangeOf(query, now));
  if (!report) return unknownReport(reportId);
  const valid = draft.from <= draft.to;
  const run = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (valid) navigate(resultsPath(report, draft));
  };
  return (
    <Page
      title={report.title}
      description={report.description}
      backTo="/reports"
      backLabel="Back to Reports"
    >
      <SectionPanel
        title="Options"
        description={
          report.usesPeriod
            ? 'Choose the dates of service to report on.'
            : 'This report has no options. It shows open balances as of today.'
        }
      >
        <form
          onSubmit={run}
          aria-label="Report options"
          className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          {report.usesPeriod ? (
            <>
              <div className="sm:w-44">
                <Input
                  id="report-from"
                  label="Service from"
                  type="date"
                  value={draft.from}
                  max={draft.to}
                  onChange={(e) => e.target.value && setDraft({ ...draft, from: e.target.value })}
                />
              </div>
              <div className="sm:w-44">
                <Input
                  id="report-to"
                  label="Service to"
                  type="date"
                  value={draft.to}
                  min={draft.from}
                  onChange={(e) => e.target.value && setDraft({ ...draft, to: e.target.value })}
                />
              </div>
            </>
          ) : null}
          <Button
            type="submit"
            disabledReason={valid ? undefined : 'Choose a start date on or before the end date.'}
          >
            <PlayIcon aria-hidden="true" className="size-4" />
            Run report
          </Button>
        </form>
      </SectionPanel>
    </Page>
  );
};

const ReportResults = ({
  client,
  report,
  range,
  query,
  now
}: {
  client: ReportsClient;
  report: AnyReport;
  range: DateRange;
  query: URLSearchParams;
  now: Date;
}) => {
  const notify = useToast();
  const [ranAt] = useState(() => now.toISOString());
  const result = useResource(`report:${report.id}:${range.from}:${range.to}`, () =>
    report.load(client, range)
  );
  const { data } = result;
  const rows = data === undefined ? [] : report.rowsOf(data);
  const page = pageParam(query);
  const pages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  const shown = rows.slice((page - 1) * REPORT_PAGE_SIZE, page * REPORT_PAGE_SIZE);
  const isPaged = rows.length > REPORT_PAGE_SIZE;
  const path = `/reports/${report.id}/results`;
  const totals = totalsOf(report.columns, rows);
  return (
    <Page
      title={report.title}
      description={periodText(report, range, now)}
      backTo={optionsPath(report, range)}
      backLabel="Back to report options"
      actions={
        data !== undefined && rows.length ? (
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon aria-hidden="true" className="size-4" />
              Print
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const name = report.fileName(data, range);
                downloadCsv(name, csvRows(report.columns, rows));
                notify({ title: `${name} downloaded` });
              }}
            >
              <DownloadIcon aria-hidden="true" className="size-4" />
              Download CSV
            </Button>
          </>
        ) : null
      }
    >
      {result.error ? (
        <Alert>{result.error.message}</Alert>
      ) : data === undefined ? (
        <PageLoading />
      ) : rows.length ? (
        <>
          <ReportDocument
            title={report.title}
            details={[
              periodText(report, range, now),
              `Run ${formatDateTime(ranAt)}`,
              ...(isPaged
                ? [
                    `Rows ${(page - 1) * REPORT_PAGE_SIZE + 1}–${Math.min(page * REPORT_PAGE_SIZE, rows.length)} of ${rows.length} · page ${page} of ${pages}`
                  ]
                : [])
            ]}
            columns={report.columns}
            rows={shown}
            totals={totals && isPaged ? ['Total, all pages', ...totals.slice(1)] : totals}
          />
          {isPaged ? (
            <div className="print:hidden">
              <Pagination
                label={report.title}
                total={rows.length}
                state={{
                  page,
                  pageSize: REPORT_PAGE_SIZE,
                  pageHref: (n) => hrefWith(path, query, { page: n > 1 ? String(n) : null })
                }}
              />
            </div>
          ) : null}
        </>
      ) : (
        <EmptyText>Nothing to report for these options.</EmptyText>
      )}
    </Page>
  );
};

export const ReportResultsPage = ({
  client,
  reportId,
  query,
  now = new Date()
}: ReportPageProps & { client: ReportsClient }) => {
  const report = findReport(reportId);
  if (!report) return unknownReport(reportId);
  return (
    <ReportResults
      client={client}
      report={report}
      range={rangeOf(query, now)}
      query={query}
      now={now}
    />
  );
};
