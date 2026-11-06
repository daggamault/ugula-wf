import { isRecord, type Json } from '@ugula/graph';
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClaimIssues, isIssueList } from '../../shared/claims/claim-issues.tsx';
import { formatDate } from '../../shared/format.ts';
import { Alert, AlertList } from '../../shared/ui/alert.tsx';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { EmptyText, emptyValue } from '../../shared/ui/empty-state.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { withBack } from '../../shared/url-state.ts';
import type { TaskClaim, TaskDetail, TaskPatient } from './client.ts';
import type { Mismatch, MismatchField } from './encounter-check.ts';

const issuesOf = (context: Json) =>
  isRecord(context) && isIssueList(context.issues) ? context.issues : [];

const noticesOf = (context: Json, key: 'warnings' | 'notes') =>
  isRecord(context) && Array.isArray(context[key])
    ? context[key].filter((r): r is string => typeof r === 'string' && r !== '')
    : [];

const reasonsOf = (context: Json) =>
  isRecord(context) && Array.isArray(context.reasons)
    ? context.reasons.filter((r): r is string => typeof r === 'string' && r !== '')
    : [];

export const headlineOf = (task: Pick<TaskDetail, 'summary' | 'context' | 'title'>) => {
  if (task.summary) return task.summary;
  const issues = issuesOf(task.context);
  return (issues.find((i) => i.severity === 'blocking') ?? issues[0])?.message ?? task.title;
};

export const TaskIssue = ({
  task,
  children
}: {
  task: Pick<TaskDetail, 'summary' | 'context' | 'title' | 'instructions' | 'kind'>;
  children?: ReactNode;
}) => {
  const issues = issuesOf(task.context);
  const reasons = reasonsOf(task.context);
  const warnings = noticesOf(task.context, 'warnings');
  const notes = noticesOf(task.context, 'notes');
  return (
    <SectionPanel
      title={task.kind === 'fault' ? 'What Went Wrong' : 'The Issue'}
      description={headlineOf(task)}
      accent="primary"
    >
      {issues.length ? <ClaimIssues issues={issues} /> : null}
      {reasons.length ? (
        <ul className="text-surface-fg-muted flex list-disc flex-col gap-1 pl-5 text-sm">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <AlertList intent="warning" title="Warnings" items={warnings.map((text) => ({ text }))} />
      ) : null}
      {notes.length ? (
        <AlertList intent="info" title="Notes" items={notes.map((text) => ({ text }))} />
      ) : null}
      {task.instructions ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">What&apos;s Needed</h3>
          <p className="text-surface-fg-muted text-sm whitespace-pre-line">{task.instructions}</p>
        </div>
      ) : null}
      {children ? <div className="border-border border-t pt-5">{children}</div> : null}
    </SectionPanel>
  );
};

const ELIGIBILITY_TEXT: Record<string, string> = { active: 'active', inactive: 'not active' };

const EncounterSays = ({
  mismatches,
  field
}: {
  mismatches: readonly Mismatch[];
  field: MismatchField;
}) => {
  const m = mismatches.find((x) => x.field === field);
  if (!m) return null;
  const value =
    field === 'birthDate' || field === 'serviceDate' ? formatDate(m.encounter) : m.encounter;
  return (
    <span className="text-warning-fg mt-1 flex items-start gap-1.5 text-xs font-medium">
      <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>Encounter says {value}</span>
    </span>
  );
};

export const MismatchAlert = ({
  mismatches,
  encounterHref
}: {
  mismatches: readonly Mismatch[];
  encounterHref: string | undefined;
}) =>
  mismatches.length ? (
    <Alert
      intent="warning"
      action={encounterHref ? <TextLink to={encounterHref}>Open Encounter</TextLink> : undefined}
    >
      {mismatches.length === 1 ? '1 value differs' : `${mismatches.length} values differ`} from the
      encounter: {mismatches.map((m) => m.label).join(', ')}.
    </Alert>
  ) : null;

const PayerList = ({ payers }: { payers: TaskClaim['payers'] }) =>
  payers.length ? (
    <ol className="flex flex-col gap-0.5">
      {payers.map((p, i) => (
        <li key={`${i}-${p.payer}`}>
          {p.payer}
          <span className="text-surface-fg-muted">
            {p.memberId ? ` · ${p.memberId}` : ''}
            {p.eligibility ? ` · ${ELIGIBILITY_TEXT[p.eligibility] ?? p.eligibility}` : ''}
          </span>
        </li>
      ))}
    </ol>
  ) : (
    'Patient only'
  );

type FactsProps = {
  taskId: string;
  mismatches?: readonly Mismatch[] | undefined;
  encounterHref?: string | undefined;
};

const SEXES: Readonly<Record<string, string>> = { F: 'Female', M: 'Male', U: 'Unknown' };

const patientAddress = (p: TaskPatient) => {
  const place = [p.city, p.state].filter(Boolean).join(', ');
  return [p.addressLine, [place, p.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
};

export const PatientFacts = ({
  patient,
  payers,
  taskId,
  mismatches = [],
  encounterHref
}: FactsProps & { patient: TaskPatient | null; payers: TaskClaim['payers'] | null }) => {
  const own = mismatches.filter((m) => m.field === 'patient' || m.field === 'birthDate');
  return (
    <SectionPanel
      title="Patient Record"
      description="Who the claim bills for, as last reported on a patient care report or claim."
      actions={
        patient ? (
          <TextLink to={withBack(`/patients/${patient.id}`, `/tasks/${taskId}`)}>
            Patient {patient.number}
          </TextLink>
        ) : null
      }
    >
      {patient ? (
        <>
          <MismatchAlert mismatches={own} encounterHref={encounterHref} />
          <DetailList>
            <Detail label="Name">
              {[patient.lastName, patient.firstName].filter(Boolean).join(', ') || emptyValue}
              <EncounterSays mismatches={own} field="patient" />
            </Detail>
            <Detail label="Birth Date">
              {patient.birthDate ? formatDate(patient.birthDate) : emptyValue}
              <EncounterSays mismatches={own} field="birthDate" />
            </Detail>
            <Detail label="Sex">{(patient.sex && SEXES[patient.sex]) || emptyValue}</Detail>
            <Detail label="Address">{patientAddress(patient) || emptyValue}</Detail>
            {payers ? (
              <Detail label="Insurance on This Claim">
                <PayerList payers={payers} />
              </Detail>
            ) : null}
          </DetailList>
        </>
      ) : (
        <EmptyText>No patient is matched to this claim yet.</EmptyText>
      )}
    </SectionPanel>
  );
};
