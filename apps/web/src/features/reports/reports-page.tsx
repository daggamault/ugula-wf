import { ArrowRightIcon, CalendarRangeIcon, DownloadIcon, PlayIcon } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import { formatDate } from '../../shared/format.ts';
import { Link, navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { interactiveClasses } from '../../shared/ui/interactive.ts';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { Section, SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { useResource } from '../../shared/use-resource.ts';
import { findReport, REPORTS, type Report } from './catalog.tsx';
import type { DateRange, ReportsClient } from './client.ts';
import { downloadCsv } from './csv.ts';

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

export const reportPath = (r: Pick<Report<unknown>, 'id' | 'usesPeriod'>, range: DateRange) =>
  r.usesPeriod
    ? `/reports/${r.id}?from=${range.from}&to=${range.to}&run=1`
    : `/reports/${r.id}?run=1`;

const ReportCard = ({ report }: { report: Report<unknown> }) => {
  const headingId = useId();
  return (
    <li>
      <Link
        to={`/reports/${report.id}`}
        aria-labelledby={headingId}
        className={classNamesOf(
          interactiveClasses,
          'border-border bg-surface hover:border-primary/50 hover:bg-primary/5 group flex h-full flex-col gap-3 rounded-xl border p-5'
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span id={headingId} className="text-base font-bold tracking-tight">
            {report.title}
          </span>
          <ArrowRightIcon
            aria-hidden="true"
            className="text-surface-fg-muted group-hover:text-primary size-4 shrink-0 transition group-hover:translate-x-0.5"
          />
        </span>
        <span className="text-surface-fg-muted text-sm">{report.description}</span>
        <span className="text-surface-fg-muted mt-auto flex items-center gap-1.5 text-xs font-semibold">
          <CalendarRangeIcon aria-hidden="true" className="size-3.5" />
          {report.usesPeriod ? 'Choose a range of service dates' : 'As of today, no options'}
        </span>
      </Link>
    </li>
  );
};

export const ReportsPage = () => (
  <Page
    title="Reports"
    description="Receivables, collections and payer performance, straight from your claims. Pick a report, set its options and run it."
  >
    <ul className="grid gap-4 sm:grid-cols-2">
      {REPORTS.map((r) => (
        <ReportCard key={r.id} report={r} />
      ))}
    </ul>
  </Page>
);

export const ReportOptions = ({ report, range }: { report: Report<unknown>; range: DateRange }) => {
  const [draft, setDraft] = useState(range);
  const valid = draft.from <= draft.to;
  const run = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (valid) navigate(reportPath(report, draft));
  };
  return (
    <SectionPanel
      title="Options"
      description={
        report.usesPeriod
          ? 'The report covers claims with a date of service in this range.'
          : 'This report always shows balances as of today.'
      }
    >
      <form onSubmit={run} className="flex flex-wrap items-end gap-4">
        {report.usesPeriod ? (
          <>
            <div className="w-44">
              <Input
                id="report-from"
                label="Service from"
                type="date"
                value={draft.from}
                max={draft.to}
                onChange={(e) => e.target.value && setDraft({ ...draft, from: e.target.value })}
              />
            </div>
            <div className="w-44">
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
  );
};

const ReportResults = ({
  client,
  report,
  range
}: {
  client: ReportsClient;
  report: Report<unknown>;
  range: DateRange;
}) => {
  const notify = useToast();
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
        report.table(data)
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
      <ReportOptions key={`${range.from}:${range.to}`} report={report} range={range} />
      {query.has('run') ? <ReportResults client={client} report={report} range={range} /> : null}
    </Page>
  );
};
