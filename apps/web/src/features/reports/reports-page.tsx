import { DownloadIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { formatDate } from '../../shared/format.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button } from '../../shared/ui/button.tsx';
import { EmptyText } from '../../shared/ui/empty-state.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { Page, PageLoading } from '../../shared/ui/page.tsx';
import { Section } from '../../shared/ui/section-panel.tsx';
import { type Resource, useResource } from '../../shared/use-resource.ts';
import type { DateRange, ReportsClient } from './client.ts';
import { type CsvCell, downloadCsv } from './csv.ts';
import {
  AgingTable,
  agingCsv,
  HcpcsTable,
  hcpcsCsv,
  MonthlyTable,
  monthlyCsv,
  PayerTable,
  payerCsv
} from './report-tables.tsx';

export type ReportsPageProps = {
  client: ReportsClient;
  now?: Date;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

export const defaultRange = (now: Date): DateRange => {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from: day(from), to: day(now) };
};

const ReportSection = <T,>({
  title,
  description,
  resource,
  isEmpty,
  csv,
  children
}: {
  title: string;
  description: ReactNode;
  resource: Resource<T>;
  isEmpty: (data: T) => boolean;
  csv: (data: T) => { name: string; rows: CsvCell[][] };
  children: (data: T) => ReactNode;
}) => {
  const { data } = resource;
  return (
    <Section
      title={title}
      description={description}
      actions={
        data && !isEmpty(data) ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const file = csv(data);
              downloadCsv(file.name, file.rows);
            }}
          >
            <DownloadIcon aria-hidden="true" className="size-4" />
            Download CSV
          </Button>
        ) : null
      }
    >
      {resource.error ? <Alert>{resource.error.message}</Alert> : null}
      {data === undefined ? (
        resource.loading ? (
          <PageLoading />
        ) : null
      ) : isEmpty(data) ? (
        <EmptyText>Nothing to report for this period.</EmptyText>
      ) : (
        children(data)
      )}
    </Section>
  );
};

export const ReportsPage = ({ client, now = new Date() }: ReportsPageProps) => {
  const [range, setRange] = useState(() => defaultRange(now));
  const period = `${range.from}:${range.to}`;
  const aging = useResource('report-aging', client.aging);
  const monthly = useResource(`report-monthly:${period}`, () => client.monthly(range));
  const payers = useResource(`report-payers:${period}`, () => client.payers(range));
  const hcpcs = useResource(`report-hcpcs:${period}`, () => client.hcpcs(range));
  const suffix = `${range.from}-to-${range.to}.csv`;
  const valid = range.from <= range.to;

  return (
    <Page
      title="Reports"
      description="Receivables, collections and payer performance, straight from your claims."
    >
      <ReportSection
        title="Accounts Receivable Aging"
        description={
          aging.data
            ? `Open balances as of ${formatDate(aging.data.asOf)}, by who owes them now: the next payer due to answer, or the patient once every payer has. Ages count from the date of service.`
            : 'Open balances by who owes them now, aged from the date of service.'
        }
        resource={aging}
        isEmpty={(d) => !d.rows.length}
        csv={(d) => ({ name: `ar-aging-${d.asOf}.csv`, rows: agingCsv(d.rows) })}
      >
        {(d) => <AgingTable rows={d.rows} />}
      </ReportSection>
      <fieldset className="border-border flex flex-wrap items-end gap-4 border-t pt-6">
        <legend className="sr-only">Report period</legend>
        <div className="w-44">
          <Input
            id="report-from"
            label="Service from"
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
          />
        </div>
        <div className="w-44">
          <Input
            id="report-to"
            label="Service to"
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
          />
        </div>
        <p className="text-surface-fg-muted pb-2.5 text-sm">
          The reports below cover claims with a date of service in this period.
        </p>
      </fieldset>
      {valid ? (
        <>
          <ReportSection
            title="Charges and Collections by Month"
            description="What was billed for each month of service, and what has come back since."
            resource={monthly}
            isEmpty={(d) => !d.rows.length}
            csv={(d) => ({ name: `monthly-${suffix}`, rows: monthlyCsv(d.rows) })}
          >
            {(d) => <MonthlyTable rows={d.rows} />}
          </ReportSection>
          <ReportSection
            title="Payer Performance"
            description="How each payer handled the claims billed to it: how many were answered, what they paid, and how long they took."
            resource={payers}
            isEmpty={(d) => !d.rows.length && !d.patient.paid_cents && !d.patient.adjusted_cents}
            csv={(d) => ({ name: `payers-${suffix}`, rows: payerCsv(d.rows, d.patient) })}
          >
            {(d) => <PayerTable rows={d.rows} patient={d.patient} />}
          </ReportSection>
          <ReportSection
            title="Charges by HCPCS Code"
            description="Billed services and mileage, by procedure code."
            resource={hcpcs}
            isEmpty={(d) => !d.rows.length}
            csv={(d) => ({ name: `hcpcs-${suffix}`, rows: hcpcsCsv(d.rows) })}
          >
            {(d) => <HcpcsTable rows={d.rows} />}
          </ReportSection>
        </>
      ) : (
        <Alert intent="warning">Choose a start date on or before the end date.</Alert>
      )}
    </Page>
  );
};
