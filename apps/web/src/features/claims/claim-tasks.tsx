import { CLAIM_TASKS, type ClaimTaskKey, isClosedStatus } from '@ugula/billing';
import {
  BuildingIcon,
  FileClockIcon,
  FilePenIcon,
  FilePlusIcon,
  HandCoinsIcon,
  ListTodoIcon,
  type LucideIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldCheckIcon,
  UsersIcon
} from 'lucide-react';
import type { MenuGroup } from '../../shared/ui/menu.tsx';
import { describeCycle } from './claim-cycle.tsx';
import type { ClaimDetail, ClaimProgress } from './client.ts';

const ICONS: Readonly<Record<ClaimTaskKey, LucideIcon>> = {
  'billing.correct-claim-data': FilePenIcon,
  'billing.change-payers': UsersIcon,
  'billing.set-facility': BuildingIcon,
  'billing.add-document': FilePlusIcon,
  'billing.chase-document': SendIcon,
  'billing.respond-records-request': FileClockIcon,
  'billing.post-payment': HandCoinsIcon
};

export const START_TASK_ICON = ListTodoIcon;

const DRAFT = 'This claim is still a draft. Finish its PCR tasks first.';

const CLOSED = 'This claim is closed.';

export const claimTaskGroups = (
  claim: Pick<ClaimDetail, 'status' | 'cycle_status' | 'coverages'>,
  progress: ClaimProgress | null,
  act: {
    onStart: (key: ClaimTaskKey) => void;
    onCheckEligibility: () => void;
    onRestart: () => void;
  }
): MenuGroup[] => {
  const closed = isClosedStatus(claim.status);
  const draft = claim.status === 'draft';
  const locked = closed ? CLOSED : draft ? DRAFT : undefined;
  const cycle = describeCycle(claim, progress);
  return [
    {
      label: 'Tasks',
      items: (Object.keys(CLAIM_TASKS) as ClaimTaskKey[]).map((key) => ({
        label: CLAIM_TASKS[key].label,
        description: CLAIM_TASKS[key].description,
        icon: ICONS[key],
        disabledReason: closed ? CLOSED : draft && !CLAIM_TASKS[key].onDrafts ? DRAFT : undefined,
        onSelect: () => act.onStart(key)
      }))
    },
    {
      label: 'Actions',
      items: [
        {
          label: 'Check Eligibility',
          description: 'Ask every payer again whether the coverage is active.',
          icon: ShieldCheckIcon,
          disabledReason:
            locked ?? (claim.coverages.length ? undefined : 'The claim has no payers.'),
          onSelect: act.onCheckEligibility
        },
        {
          label: 'Restart Payer Cycle',
          description: 'Start the payer cycle again after it stopped.',
          icon: RotateCcwIcon,
          disabledReason:
            locked ?? (cycle?.restartable ? undefined : 'The payer cycle has not stopped.'),
          onSelect: act.onRestart
        }
      ]
    }
  ];
};

const TASK_WAIT_MS = 500;

const TASK_TRIES = 30;

export const waitForTask = async (
  find: () => Promise<string | null>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
) => {
  for (let i = 0; i < TASK_TRIES; i++) {
    const id = await find();
    if (id) return id;
    await sleep(TASK_WAIT_MS);
  }
  return null;
};
