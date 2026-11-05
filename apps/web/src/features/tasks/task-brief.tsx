import { TRIP_TYPE_LABELS, type TripType } from '@ugula/billing';
import { isRecord, type Json } from '@ugula/graph';
import { TriangleAlertIcon } from 'lucide-react';
import { ClaimIssues, isIssueList } from '../../shared/claims/claim-issues.tsx';
import { formatCents, formatDate } from '../../shared/format.ts';
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
  task
}: {
  task: Pick<TaskDetail, 'summary' | 'context' | 'title' | 'instructions' | 'kind'>;
}) => {
  const issues = issuesOf(task.context);
  const reasons = reasonsOf(task.context);
  const warnings = noticesOf(task.context, 'warnings');
  const notes = noticesOf(task.context, 'notes');
  return (
    <SectionPanel
      title={task.kind === 'fault' ? 'What Went Wrong' : 'The Issue'}
      description="What this task is about, why it was raised and what it needs from you."
      accent="primary"
    >
      <p className="text-base font-semibold">{headlineOf(task)}</p>
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
    </SectionPanel>
  );
};

const tripText = (c: TaskClaim) => {
  const trip =
    c.tripType && Object.hasOwn(TRIP_TYPE_LABELS, c.tripType)
      ? TRIP_TYPE_LABELS[c.tripType as TripType]
      : null;
  const service = c.level
    ? `${c.level}${c.emergency === null ? '' : c.emergency ? ' emergency' : ' non-emergency'}`
    : null;
  return [trip, service].filter(Boolean).join(' · ') || emptyValue;
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

const MismatchAlert = ({
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

export const ClaimFacts = ({
  claim,
  taskId,
  mismatches = [],
  encounterHref
}: FactsProps & { claim: TaskClaim }) => (
  <SectionPanel
    title="Claim"
    description="What is billed: the claim as it stands now."
    actions={
      <TextLink to={withBack(`/claims/${claim.id}`, `/tasks/${taskId}`)}>
        Claim {claim.number}
      </TextLink>
    }
  >
    <MismatchAlert mismatches={mismatches} encounterHref={encounterHref} />
    <DetailList>
      <Detail label="Patient">
        {claim.patient ?? 'Not matched yet'}
        {claim.birthDate ? (
          <span className="text-surface-fg-muted"> · born {formatDate(claim.birthDate)}</span>
        ) : null}
        <EncounterSays mismatches={mismatches} field="patient" />
        <EncounterSays mismatches={mismatches} field="birthDate" />
      </Detail>
      <Detail label="Date of Service">
        {claim.serviceDate ? formatDate(claim.serviceDate) : emptyValue}
        <EncounterSays mismatches={mismatches} field="serviceDate" />
      </Detail>
      <Detail label="Trip">{tripText(claim)}</Detail>
      <Detail label="Loaded Miles">
        {claim.loadedMiles === null ? emptyValue : String(claim.loadedMiles)}
        <EncounterSays mismatches={mismatches} field="loadedMiles" />
      </Detail>
      <Detail label="Payers">
        <PayerList payers={claim.payers} />
        <EncounterSays mismatches={mismatches} field="memberId" />
      </Detail>
      <Detail label="Charges">
        {claim.lines.length ? (
          <ul className="flex flex-col gap-0.5 tabular-nums">
            {claim.lines.map((l, i) => (
              <li key={`${i}-${l.code}`}>
                {l.code} × {l.units} · {formatCents(l.totalCents)}
              </li>
            ))}
          </ul>
        ) : (
          emptyValue
        )}
      </Detail>
      <Detail label="Total">
        {claim.totalCents === null ? emptyValue : formatCents(claim.totalCents)}
      </Detail>
      <Detail label="Balance" isEmphasized>
        {claim.balanceCents === null ? emptyValue : formatCents(claim.balanceCents)}
      </Detail>
    </DetailList>
  </SectionPanel>
);

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
      title="Patient"
      description="The patient record the claim bills for, as last reported."
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
