import type { ReactNode } from 'react';
import { formatCents, formatDate } from '../../shared/format.ts';
import { type Live, useLive } from '../../shared/live.ts';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { Page, PageFailure, PageLoading } from '../../shared/ui/page.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useResource } from '../../shared/use-resource.ts';
import type { PatientSummary, PatientsClient } from './client.ts';

export type PatientPageProps = {
  client: PatientsClient;
  live: Live;
  patientId: string;
  claims: ReactNode;
  /** The patient list to return to, with its search and page. */
  back?: string;
};

const SEXES: Readonly<Record<string, string>> = { F: 'Female', M: 'Male', U: 'Unknown' };

export const addressOf = (p: PatientSummary) => {
  const place = [p.city, p.state].filter(Boolean).join(', ');
  return [p.address_line, [place, p.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
};

export const PatientDetails = ({ patient }: { patient: PatientSummary }) => (
  <SectionPanel title="Details" description="As last reported on a patient care report or claim.">
    <DetailList>
      <Detail label="Open Balance" isEmphasized>
        {formatCents(patient.balance_cents)}
      </Detail>
      <Detail label="Birth Date">{formatDate(patient.birth_date)}</Detail>
      <Detail label="Sex">{(patient.gender && SEXES[patient.gender]) ?? emptyValue}</Detail>
      <Detail label="Address">{addressOf(patient) || emptyValue}</Detail>
    </DetailList>
  </SectionPanel>
);

export const PatientPage = ({
  client,
  claims,
  live,
  patientId,
  back = '/patients'
}: PatientPageProps) => {
  const patient = useResource(`patient:${patientId}`, () => client.find(patientId));
  useLive(live, (e) => e.kind === 'claim', patient.reload);
  if (patient.error) return <PageFailure message={patient.error.message} />;
  if (!patient.data) return <PageLoading />;
  const p = patient.data;
  return (
    <Page
      title={`${p.last_name}, ${p.first_name}`}
      description={`Born ${formatDate(p.birth_date)}`}
      backTo={back}
      backLabel="Back to Patients"
    >
      <PatientDetails patient={p} />
      {claims}
    </Page>
  );
};
