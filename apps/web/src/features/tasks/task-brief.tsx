import { TRIP_TYPE_LABELS, type TripType } from '@ugula/billing';
import { isRecord, type Json } from '@ugula/graph';
import { ClaimIssues, isIssueList } from '../../shared/claims/claim-issues.tsx';
import { formatCents, formatDate } from '../../shared/format.ts';
import { Detail, DetailList } from '../../shared/ui/detail-list.tsx';
import { emptyValue } from '../../shared/ui/empty-state.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { TextLink } from '../../shared/ui/text-link.tsx';
import { withBack } from '../../shared/url-state.ts';
import type { TaskClaim, TaskDetail } from './client.ts';

const issuesOf = (context: Json) =>
  isRecord(context) && isIssueList(context.issues) ? context.issues : [];

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

export const ClaimFacts = ({ claim, taskId }: { claim: TaskClaim; taskId: string }) => (
  <SectionPanel
    title="Claim"
    description="Where the claim this task is about stands right now."
    actions={
      <TextLink to={withBack(`/claims/${claim.id}`, `/tasks/${taskId}`)}>
        Claim {claim.number}
      </TextLink>
    }
  >
    <DetailList>
      <Detail label="Patient">
        {claim.patient ?? 'Not matched yet'}
        {claim.birthDate ? (
          <span className="text-surface-fg-muted"> · born {formatDate(claim.birthDate)}</span>
        ) : null}
      </Detail>
      <Detail label="Date of Service">
        {claim.serviceDate ? formatDate(claim.serviceDate) : emptyValue}
      </Detail>
      <Detail label="Trip">{tripText(claim)}</Detail>
      <Detail label="Loaded Miles">
        {claim.loadedMiles === null ? emptyValue : String(claim.loadedMiles)}
      </Detail>
      <Detail label="Payers">
        {claim.payers.length ? (
          <ol className="flex flex-col gap-0.5">
            {claim.payers.map((p, i) => (
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
        )}
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
