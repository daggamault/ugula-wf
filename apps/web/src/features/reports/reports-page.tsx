import { DownloadIcon, PlayIcon, PrinterIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { messageOf } from '../../shared/api.ts';
import { formatDate, formatDateTime } from '../../shared/format.ts';
import { type Live, useReconnect } from '../../shared/live.ts';
import { navigate } from '../../shared/router.tsx';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { FieldGrid, FormActions } from '../../shared/ui/field.tsx';
import { IconLink, RowActions } from '../../shared/ui/icon-button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { Pagination, pageCount, rangeText } from '../../shared/ui/pagination.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { Select } from '../../shared/ui/select.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import { useToast } from '../../shared/ui/toast.tsx';
import { hrefWith } from '../../shared/url-state.ts';
import { useResource } from '../../shared/use-resource.ts';
import { type AnyReport, type DateKind, findReport, groupOf, REPORTS } from './catalog.ts';
import type { DateRange, ReportOptions, ReportsClient } from './client.ts';
import { downloadCsv } from './csv.ts';
import { csvRows, totalsOf } from './report-columns.ts';
import { ReportDocument } from './report-document.tsx';

const REPORT_PAGE_SIZE = 100;

const DATES: Readonly<Record<DateKind, { label: string; period: string; noun: string }>> = {
  service: { label: 'Service', period: 'Dates of service', noun: 'dates of service' },
  posted: { label: 'Posted', period: 'Posted', noun: 'posting dates' },
  closed: { label: 'Closed', period: 'Closed', noun: 'dates claims closed' },
  completed: { label: 'Completed', period: 'Completed', noun: 'dates work was done' },
  received: { label: 'Received', period: 'Received', noun: 'dates files were received' }
};

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

type ReportShape = Pick<AnyReport, 'id' | 'dates' | 'groups'>;

export const optionsOf = (r: ReportShape, query: URLSearchParams, now: Date): ReportOptions => ({
  range: r.dates ? rangeOf(query, now) : null,
  group: groupOf(r, query.get('group'))?.value ?? null
});

const pathWith = (path: string, { range, group }: ReportOptions) =>
  hrefWith(path, new URLSearchParams(), {
    from: range?.from ?? null,
    to: range?.to ?? null,
    group
  });

export const optionsPath = (r: Pick<AnyReport, 'id'>, o: ReportOptions) =>
  pathWith(`/reports/${r.id}`, o);

export const resultsPath = (r: Pick<AnyReport, 'id'>, o: ReportOptions) =>
  pathWith(`/reports/${r.id}/results`, o);

export const pageParam = (query: URLSearchParams) => {
  const n = Number(query.get('page'));
  return Number.isInteger(n) && n > 1 ? n : 1;
};

export const periodText = (r: Pick<AnyReport, 'dates'>, { range }: ReportOptions, asOf: string) =>
  r.dates && range
    ? `${DATES[r.dates].period} ${formatDate(range.from)} to ${formatDate(range.to)}`
    : `As of ${formatDate(asOf)}`;

export const fileNameOf = (
  r: Pick<AnyReport, 'id'>,
  { range, group }: ReportOptions,
  asOf: string
) =>
  [r.id, group ? `by-${group}` : null, range ? `${range.from}-to-${range.to}` : asOf]
    .filter(Boolean)
    .join('-')
    .concat('.csv');

export const ReportsPage = () => (
  <Page
    title="Reports"
    description="Receivables, collections, payer performance and billing work, straight from your claims."
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
            <RowActions>
              <IconLink
                to={`/reports/${r.id}`}
                label={`Run ${r.title}`}
                tooltip="Run"
                icon={PlayIcon}
              />
            </RowActions>
          </TableCell>
        </TableRow>
      ))}
    </Table>
  </Page>
);

type ReportPageProps = {
  reportId: string;
  query: URLSearchParams;
  now?: Date;
};

const unknownReport = (id: string) => (
  <PageFailure message={`There is no report called “${id}”.`} />
);

const optionsHelp = (r: AnyReport) =>
  r.dates
    ? `Choose the ${DATES[r.dates].noun} to report on.`
    : r.groups
      ? 'Choose how to group the report. It shows where things stand right now.'
      : 'This report has no options. It shows where things stand right now.';

const ReportOptionsForm = ({ report, initial }: { report: AnyReport; initial: ReportOptions }) => {
  const [draft, setDraft] = useState(initial);
  const { range } = draft;
  const valid = !range || range.from <= range.to;
  const dates = report.dates ? DATES[report.dates] : null;
  const run = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (valid) navigate(resultsPath(report, draft));
  };
  const setRange = (patch: Partial<DateRange>) =>
    range && setDraft({ ...draft, range: { ...range, ...patch } });
  return (
    <SectionPanel title="Options" description={optionsHelp(report)}>
      <form onSubmit={run} aria-label="Report options" className="flex flex-col gap-5">
        {range || report.groups ? (
          <FieldGrid>
            {range && dates ? (
              <>
                <Input
                  id="report-from"
                  label={`${dates.label} From`}
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={(e) => e.target.value && setRange({ from: e.target.value })}
                />
                <Input
                  id="report-to"
                  label={`${dates.label} To`}
                  type="date"
                  value={range.to}
                  min={range.from}
                  onChange={(e) => e.target.value && setRange({ to: e.target.value })}
                />
              </>
            ) : null}
            {report.groups ? (
              <Select
                id="report-group"
                label="Group By"
                value={draft.group ?? ''}
                options={report.groups}
                onChange={(e) => setDraft({ ...draft, group: e.target.value })}
              />
            ) : null}
          </FieldGrid>
        ) : null}
        <FormActions>
          <Button
            type="submit"
            disabledReason={valid ? undefined : 'Choose a start date on or before the end date.'}
          >
            <PlayIcon aria-hidden="true" className="size-4" />
            Run Report
          </Button>
        </FormActions>
      </form>
    </SectionPanel>
  );
};

export const ReportOptionsPage = ({ reportId, query, now = new Date() }: ReportPageProps) => {
  const report = findReport(reportId);
  if (!report) return unknownReport(reportId);
  return (
    <Page
      title={report.title}
      description={report.description}
      backTo="/reports"
      backLabel="Back to Reports"
    >
      <ReportOptionsForm report={report} initial={optionsOf(report, query, now)} />
    </Page>
  );
};

const ReportResults = ({
  client,
  report,
  options,
  live,
  query,
  now
}: {
  client: ReportsClient;
  live: Live;
  report: AnyReport;
  options: ReportOptions;
  query: URLSearchParams;
  now: Date;
}) => {
  const notify = useToast();
  const [ranAt] = useState(() => now.toISOString());
  const [isExporting, setExporting] = useState(false);
  const page = pageParam(query);
  const result = useResource(`report:${resultsPath(report, options)}:${page}`, () =>
    client.run<unknown>(report.id, options, page)
  );
  useReconnect(live, result.reload);
  const { data } = result;
  const columns = report.columns(options.group);
  const asOf = data?.asOf ?? day(now);
  const period = periodText(report, options, asOf);
  const group = report.groups ? groupOf(report, options.group) : null;
  const isPaged = data !== undefined && data.total > REPORT_PAGE_SIZE;
  const download = async () => {
    setExporting(true);
    try {
      const all = await client.run<unknown>(report.id, options, 'all');
      const name = fileNameOf(report, options, all.asOf);
      downloadCsv(name, csvRows(columns, all.items, all.totals));
      notify({ title: `${name} downloaded` });
    } catch (err) {
      notify({
        intent: 'danger',
        title: 'Could not download the report',
        description: messageOf(err)
      });
    } finally {
      setExporting(false);
    }
  };
  return (
    <Page
      title={report.title}
      description={period}
      backTo={optionsPath(report, options)}
      backLabel="Back to Report Options"
      actions={
        data?.total ? (
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon aria-hidden="true" className="size-4" />
              Print
            </Button>
            <Button variant="outline" isPending={isExporting} onClick={download}>
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
      ) : data.total ? (
        <>
          <ReportDocument
            title={report.title}
            details={[
              period,
              ...(group ? [`Grouped by ${group.label}`] : []),
              `Run ${formatDateTime(ranAt)}`,
              ...(isPaged
                ? [
                    `Rows ${rangeText(page, REPORT_PAGE_SIZE, data.total)} · page ${page} of ${pageCount(data.total, REPORT_PAGE_SIZE)}`
                  ]
                : [])
            ]}
            columns={columns}
            rows={data.items}
            totals={data.totals}
            footer={totalsOf(columns, data.totals)}
          />
          {isPaged ? (
            <div className="print:hidden">
              <Pagination
                label={report.title}
                total={data.total}
                state={{
                  page,
                  pageSize: REPORT_PAGE_SIZE,
                  pageHref: (n) =>
                    hrefWith(`/reports/${report.id}/results`, query, {
                      page: n > 1 ? String(n) : null
                    })
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
  live,
  reportId,
  query,
  now = new Date()
}: ReportPageProps & { client: ReportsClient; live: Live }) => {
  const report = findReport(reportId);
  if (!report) return unknownReport(reportId);
  return (
    <ReportResults
      client={client}
      live={live}
      report={report}
      options={optionsOf(report, query, now)}
      query={query}
      now={now}
    />
  );
};
