import { isClosedStatus } from '@ugula/billing';
import { ExternalLinkIcon, ListTodoIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { formatAgo, formatCents } from '../../shared/format.ts';
import { queueInfo } from '../../shared/task-queues.ts';
import { Alert } from '../../shared/ui/alert.tsx';
import { Button, ButtonLink } from '../../shared/ui/button.tsx';
import type { Intent } from '../../shared/ui/intent.ts';
import { withBack } from '../../shared/url-state.ts';
import { assigneeOf } from './claims-page.tsx';
import type { ClaimDetail, ClaimProgress, ClaimTask } from './client.ts';

export const describeProgress = (progress: ClaimProgress): string => {
  switch (progress.step) {
    case 'review':
      return `Needs review before it goes to ${progress.coverage.payer}. Check the claim, then approve its review task. Its 837P file is created as soon as it is approved.`;
    case 'submit':
      return `Approved. Creating its 837P file for ${progress.coverage.payer}; a task opens if it cannot be created.`;
    case 'reconcile':
      return `${progress.coverage.payer} answered and a balance remains. A reconcile task is waiting.`;
    case 'workDenial':
      return `${progress.coverage.payer} denied the claim. A denial decision, correction or appeal is being worked.`;
    case 'await':
      return `Waiting on ${progress.coverage.payer}. A follow-up task opens if they have not answered 30 days after submission.`;
    case 'followUp':
      return `${progress.coverage.payer} has not answered in 30 days. A payer follow-up task is waiting.`;
    case 'reviewPatient':
      return 'Every payer is done. A review task is waiting before the patient is billed.';
    case 'confirmPayers':
      return 'No payer is on this claim. A task is waiting to add one or confirm the patient pays.';
    case 'overpaid':
      return `${formatCents(-progress.balanceCents)} more has been paid than the claim charges. A refund task is waiting.`;
    case 'statement':
      return `Sending patient statement ${progress.statement} of 3.`;
    case 'awaitPatient':
      return 'Waiting on the patient. The next statement goes out 30 days after the last one.';
    case 'facility':
      return 'A facility is responsible for this trip. It is billed on the monthly facility invoice.';
    case 'collections':
      return 'Every payer and patient statement is done. A balance review task is waiting for a decision.';
    case 'writeOff':
      return 'The balance left is within what the agency writes off. Closing as written off.';
    case 'closed':
      return 'Paid in full. Closing.';
  }
};

type CycleState = {
  intent: Intent;
  text: string;
  stopped: boolean;
  restartable: boolean;
};

export const describeCycle = (
  claim: Pick<ClaimDetail, 'status' | 'cycle_status'>,
  progress: ClaimProgress | null
): CycleState | null => {
  if (isClosedStatus(claim.status)) return null;
  const base = { stopped: true };
  if (claim.status === 'draft') {
    return {
      ...base,
      stopped: false,
      restartable: false,
      intent: 'info',
      text: 'Draft. Its PCR is still being worked into a claim.'
    };
  }
  switch (claim.cycle_status) {
    case null:
      return {
        ...base,
        intent: 'warning',
        text: 'No payer cycle is running for this claim.',
        restartable: true
      };
    case 'failed':
    case 'cancelled':
      return {
        ...base,
        intent: 'danger',
        text: `The payer cycle ${claim.cycle_status === 'failed' ? 'failed' : 'was cancelled'}, so nothing more will happen on this claim until it is restarted.`,
        restartable: true
      };
    case 'faulted':
      return {
        ...base,
        intent: 'danger',
        text: 'The payer cycle hit an error. A stuck run task is waiting for a decision.',
        restartable: false
      };
    default: {
      if (!progress) return null;
      return {
        intent: progress.step === 'overpaid' ? 'warning' : 'info',
        text: describeProgress(progress),
        stopped: false,
        restartable: false
      };
    }
  }
};

export const CycleAlert = ({
  claim,
  progress,
  onRestart
}: {
  claim: ClaimDetail;
  progress: ClaimProgress | null;
  onRestart: () => Promise<void>;
}) => {
  const [restarting, setRestarting] = useState(false);
  const status = describeCycle(claim, progress);
  if (!status) return null;
  const runLink = status.stopped && claim.cycle_run_id ? claim.cycle_run_id : null;
  const actions = (
    <>
      {runLink ? (
        <ButtonLink to={`/runs/${runLink}`} variant="outline">
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
          Open Cycle Run
        </ButtonLink>
      ) : null}
      {status.restartable ? (
        <Button
          variant="outline"
          isPending={restarting}
          onClick={async () => {
            setRestarting(true);
            await onRestart();
            setRestarting(false);
          }}
        >
          <RotateCcwIcon aria-hidden="true" className="size-4" />
          Restart Payer Cycle
        </Button>
      ) : null}
    </>
  );
  return (
    <Alert intent={status.intent} action={actions}>
      {status.text}
    </Alert>
  );
};

export const OpenTasks = ({
  tasks,
  back,
  me
}: {
  tasks: readonly ClaimTask[];
  back: string;
  me: string;
}) =>
  tasks.map((t) => (
    <Alert
      key={t.id}
      intent={t.kind === 'fault' ? 'danger' : 'warning'}
      action={
        <ButtonLink to={withBack(`/tasks/${t.id}`, back)}>
          <ListTodoIcon aria-hidden="true" className="size-4" />
          Work Task
        </ButtonLink>
      }
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{t.title}</span>
        <span className="text-xs">
          {queueInfo(t.queue).label} · {assigneeOf(t.assignee_email, me)} · opened{' '}
          {formatAgo(t.created_at)}
        </span>
      </span>
    </Alert>
  ));
