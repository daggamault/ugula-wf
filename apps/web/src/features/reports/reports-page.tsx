import { ChartColumnIcon, DownloadIcon, RefreshCwIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDate } from '../../shared/format.ts';
import { Link, navigate, useLocation } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination } from '../../shared/ui/pagination.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { hrefWith, pageOf, type TableState, useTableState } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { findReport, REPORTS, type Report } from './catalog.tsx';
import type { DateRange, ReportsClient } from './client.ts';
import { downloadCsv } from './csv.ts';

type AnyReport = Report<unknown, unknown>;

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

export const reportPath = (
  r: Pick<AnyReport, 'id' | 'usesPeriod'>,
  range: DateRange,
  query: URLSearchParams = new URLSearchParams()
) =>
  hrefWith(`/reports/${r.id}`, query, {
    from: r.usesPeriod ? range.from : null,
    to: r.usesPeriod ? range.to : null,
    page: null
  });

export const ReportsPage = () => (
  <Page
    title="Reports"
    description="Receivables, collections and payer performance, straight from your claims."
  >
    <ul className="grid gap-4 md:grid-cols-2">
      {REPORTS.map((r) => (
        <li key={r.id} className="flex">
          <Link
            to={`/reports/${r.id}`}
            className={classNamesOf(
              interactiveClasses,
              'border-border bg-surface hover:border-primary/50 hover:bg-primary/5 flex flex-1 flex-col gap-2 rounded-xl border p-5'
            )}
          >
            <span className="text-primary flex items-center gap-2 font-bold">
              <ChartColumnIcon aria-hidden="true" className="size-4.5" />
              {r.title}
            </span>
            <span className="text-surface-fg-muted text-sm">{r.description}</span>
          </Link>
        </li>
      ))}
    </ul>
  </Page>
);

export const ReportOptions = ({ report, range }: { report: AnyReport; range: DateRange }) => {
  const [draft, setDraft] = useState(range);
  const { query } = useLocation();
  const valid = draft.from <= draft.to;
  const changed = draft.from !== range.from || draft.to !== range.to;
  const run = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (valid) navigate(reportPath(report, draft, query));
  };
  return (
    <form
      onSubmit={run}
      aria-label="Report options"
      className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
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
      <Button
        type="submit"
        variant="outline"
        disabledReason={
          valid
            ? changed
              ? undefined
              : 'Change the dates first.'
            : 'Choose a start date on or before the end date.'
        }
      >
        <RefreshCwIcon aria-hidden="true" className="size-4" />
        Update
      </Button>
    </form>
  );
};

const ReportRows = ({
  report,
  data,
  state
}: {
  report: AnyReport;
  data: unknown;
  state: TableState<string>;
}) => {
  const page = pageOf(report.rowsOf(data), state, report.values);
  return (
    <>
      {report.table(data, page.items, state)}
      <Pagination label={report.title} total={page.total} state={state} />
    </>
  );
};

const ReportResults = ({
  client,
  report,
  range
}: {
  client: ReportsClient;
  report: AnyReport;
  range: DateRange;
}) => {
  const notify = useToast();
  const table = useTableState(`/reports/${report.id}`, report);
  const result = useResource(`report:${report.id}:${range.from}:${range.to}`, () =>
    report.load(client, range)
  );
  const { data } = result;
  return (
    <Section
      title="Results"
      description={
        report.usesPeriod
          ? `Claims with a date of service from ${formatDate(range.from)} to ${formatDate(range.to)}.`
          : 'Open balances as of today.'
      }
      actions={
        data !== undefined && !report.isEmpty(data) ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const file = report.csv(data, range);
              downloadCsv(file.name, file.rows);
              notify({ title: `${file.name} downloaded` });
            }}
          >
            <DownloadIcon aria-hidden="true" className="size-4" />
            Download CSV
          </Button>
        ) : null
      }
    >
      {result.error ? <Alert>{result.error.message}</Alert> : null}
      {data === undefined ? (
        result.loading ? (
          <PageLoading />
        ) : null
      ) : report.isEmpty(data) ? (
        <EmptyText>Nothing to report for these options.</EmptyText>
      ) : (
        <ReportRows report={report} data={data} state={table} />
      )}
    </Section>
  );
};

export type ReportPageProps = {
  client: ReportsClient;
  reportId: string;
  query: URLSearchParams;
  now?: Date;
};

export const ReportPage = ({ client, reportId, query, now = new Date() }: ReportPageProps) => {
  const report = findReport(reportId);
  if (!report) return <PageFailure message={`There is no report called “${reportId}”.`} />;
  const range = rangeOf(query, now);
  return (
    <Page
      title={report.title}
      description={report.description}
      backTo="/reports"
      backLabel="Back to Reports"
    >
      {report.usesPeriod ? (
        <ReportOptions key={`${range.from}:${range.to}`} report={report} range={range} />
      ) : null}
      <ReportResults client={client} report={report} range={range} />
    </Page>
  );
};
