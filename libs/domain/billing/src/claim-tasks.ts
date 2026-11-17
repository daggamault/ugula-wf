import { isClosedStatus, isReopenableStatus } from './claims.ts';

type ClaimTask = { label: string; description: string; onDrafts: boolean; onClosed: boolean };

export const CLAIM_TASKS = {
  'billing.correct-claim-data': {
    label: 'Correct Claim Data',
    description: 'Change what goes on the 837P; charges are priced again when needed.',
    onDrafts: false,
    onClosed: false
  },
  'billing.change-responsible-party': {
    label: 'Change Responsible Party',
    description: 'Add, reorder or remove the payers, or bill a facility for the trip instead.',
    onDrafts: false,
    onClosed: false
  },
  'billing.discover-insurance': {
    label: 'Discover Insurance',
    description: 'Search the payers that accept searches for coverage the patient did not report.',
    onDrafts: false,
    onClosed: false
  },
  'billing.receive-document': {
    label: 'Add Document',
    description: 'Upload a facesheet, certification, signature form, ABN or MSP form.',
    onDrafts: true,
    onClosed: false
  },
  'billing.chase-document': {
    label: 'Chase Document',
    description: 'Get a missing document by a due date.',
    onDrafts: false,
    onClosed: false
  },
  'billing.log-records-request': {
    label: 'Log Records Request',
    description: 'A payer asked for records; send them by the due date.',
    onDrafts: false,
    onClosed: false
  },
  'billing.post-payment': {
    label: 'Post Payment',
    description: 'A payment or refund that came by mail, phone or card.',
    onDrafts: false,
    onClosed: true
  },
  'billing.set-up-payment-plan': {
    label: 'Set Up Payment Plan',
    description: 'Let the patient pay the balance in installments.',
    onDrafts: false,
    onClosed: false
  }
} as const satisfies Record<string, ClaimTask>;

export type ClaimTaskKey = keyof typeof CLAIM_TASKS;

export const CLAIM_TASK_KEYS = Object.keys(CLAIM_TASKS) as [ClaimTaskKey, ...ClaimTaskKey[]];

export const claimTaskStartsOn = (key: ClaimTaskKey, status: string) =>
  status === 'draft'
    ? CLAIM_TASKS[key].onDrafts
    : !isClosedStatus(status) || (CLAIM_TASKS[key].onClosed && isReopenableStatus(status));

const MAX_CLAIM_PAYERS = 10;

const MAX_PAYER_NAME = 60;

export const readPayerNames = (x: unknown): string[] | string => {
  const names = (Array.isArray(x) ? x : [])
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length > MAX_CLAIM_PAYERS) return `A claim can have at most ${MAX_CLAIM_PAYERS} payers`;
  const long = names.find((n) => n.length > MAX_PAYER_NAME);
  if (long) return `Payer names have at most ${MAX_PAYER_NAME} characters: ${long}`;
  const seen = new Set<string>();
  const twice = names.find((n) => seen.size === seen.add(n.toLowerCase()).size);
  return twice ? `${twice} is listed twice` : names;
};
