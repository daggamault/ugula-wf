import type { ReactNode } from 'react';
import { formatDate, formatDateTime, formatMiles } from '../../shared/format.ts';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { Table, TableCell, TableRow } from '../../shared/ui/table.tsx';
import type { PcrSummary } from './pcr-reader.ts';

type Facts = PcrSummary['patient'];

const subheading = 'text-surface-fg-muted text-xs font-semibold tracking-wide uppercase';

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-3">
    <h3 className={subheading}>{title}</h3>
    {children}
  </section>
);

const FactDetails = ({ facts }: { facts: Facts }) =>
  facts.map((f) => (
    <Detail key={f.label} label={f.label}>
      {f.value === null ? emptyValue : f.isDay ? formatDate(f.value) : f.value}
    </Detail>
  ));

const When = ({ at }: { at: string | null }) =>
  at ? <time dateTime={at}>{formatDateTime(at)}</time> : emptyValue;

const numberText = (n: number | null) => (n === null ? emptyValue : String(n));

export const PcrSummaryView = ({ pcr }: { pcr: PcrSummary }) => (
  <div className="flex flex-col gap-6">
    <Part title="Patient">
      <DetailList>
        <FactDetails facts={pcr.patient} />
        <Detail label="Payment Method">{pcr.paymentMethod ?? emptyValue}</Detail>
      </DetailList>
      {pcr.insurances.length ? (
        <Table
          label="Insurances on the report"
          head={['Payer', 'Priority', 'Member ID', 'Group', 'Insured Relationship']}
        >
          {pcr.insurances.map((i, n) => (
            <TableRow key={`${n}:${i.payer}`}>
              <TableCell kind="wrap">{i.payer ?? emptyValue}</TableCell>
              <TableCell>{i.priority ?? emptyValue}</TableCell>
              <TableCell>{i.memberId ?? emptyValue}</TableCell>
              <TableCell>{i.groupId ?? emptyValue}</TableCell>
              <TableCell>{i.relationship ?? emptyValue}</TableCell>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyText>No insurances on the report.</EmptyText>
      )}
    </Part>
    <Part title="Times">
      <DetailList>
        {pcr.times.map((t) => (
          <Detail key={t.label} label={t.label}>
            <When at={t.at} />
          </Detail>
        ))}
      </DetailList>
    </Part>
    <div className="grid gap-6 lg:grid-cols-2">
      <Part title="Scene / Pickup">
        <DetailList>
          <FactDetails facts={pcr.scene} />
        </DetailList>
      </Part>
      <Part title="Destination">
        <DetailList>
          <FactDetails facts={pcr.destination} />
        </DetailList>
      </Part>
    </div>
    <Part title="Response and Disposition">
      <DetailList>
        <FactDetails facts={pcr.response} />
      </DetailList>
    </Part>
    <Part title="Situation">
      <DetailList>
        <FactDetails facts={pcr.situation} />
      </DetailList>
    </Part>
    <Part title="Vitals">
      {pcr.vitals.length ? (
        <Table
          label="Vital signs"
          head={[
            'Taken At',
            'Blood Pressure',
            'Heart Rate',
            'SpO2',
            'Resp. Rate',
            'Glucose',
            'GCS'
          ]}
        >
          {pcr.vitals.map((v, n) => (
            <TableRow key={`${n}:${v.takenAt}`}>
              <TableCell kind="date">
                <When at={v.takenAt} />
              </TableCell>
              <TableCell kind="numeric">{v.bloodPressure ?? emptyValue}</TableCell>
              <TableCell kind="numeric">{numberText(v.heartRate)}</TableCell>
              <TableCell kind="numeric">
                {v.pulseOximetry === null ? emptyValue : `${v.pulseOximetry}%`}
              </TableCell>
              <TableCell kind="numeric">{numberText(v.respiratoryRate)}</TableCell>
              <TableCell kind="numeric">{numberText(v.bloodGlucose)}</TableCell>
              <TableCell kind="numeric">{numberText(v.glasgowComaScore)}</TableCell>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyText>No vital signs on the report.</EmptyText>
      )}
    </Part>
    <Part title="Medications">
      {pcr.medications.length ? (
        <Table label="Medications given" head={['Medication', 'Given At', 'Route', 'Dose']}>
          {pcr.medications.map((m, n) => (
            <TableRow key={`${n}:${m.givenAt}`}>
              <TableCell kind="wrap">{m.medication ?? emptyValue}</TableCell>
              <TableCell kind="date">
                <When at={m.givenAt} />
              </TableCell>
              <TableCell>{m.route ?? emptyValue}</TableCell>
              <TableCell kind="numeric">{m.dose ?? emptyValue}</TableCell>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyText>No medications on the report.</EmptyText>
      )}
    </Part>
    <Part title="Procedures">
      {pcr.procedures.length ? (
        <Table label="Procedures performed" head={['Procedure', 'Performed At']}>
          {pcr.procedures.map((p, n) => (
            <TableRow key={`${n}:${p.performedAt}`}>
              <TableCell kind="wrap">{p.procedure ?? emptyValue}</TableCell>
              <TableCell kind="date">
                <When at={p.performedAt} />
              </TableCell>
            </TableRow>
          ))}
        </Table>
      ) : (
        <EmptyText>No procedures on the report.</EmptyText>
      )}
    </Part>
    <Part title="Narrative">
      {pcr.narrative ? (
        <p className="max-w-prose text-sm whitespace-pre-wrap">{pcr.narrative}</p>
      ) : (
        <EmptyText>No narrative on the report.</EmptyText>
      )}
    </Part>
    <Part title="Odometer">
      <DetailList>
        <Detail label="Loaded Miles" isEmphasized>
          {pcr.loadedMiles === null ? emptyValue : formatMiles(pcr.loadedMiles)}
        </Detail>
        <FactDetails facts={pcr.odometer} />
      </DetailList>
    </Part>
  </div>
);
