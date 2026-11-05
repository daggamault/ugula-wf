type ClaimTask = { label: string; description: string; onDrafts: boolean };

export const CLAIM_TASKS = {
  'billing.correct-claim-data': {
    label: 'Correct Claim Data',
    description: 'Change what goes on the 837P; charges are priced again when needed.',
    onDrafts: false
  },
  'billing.change-payers': {
    label: 'Change Payers',
    description: 'Add, reorder or remove the payers the claim is billed to.',
    onDrafts: false
  },
  'billing.set-facility': {
    label: 'Set Responsible Facility',
    description: 'Bill a facility for the trip instead of the payers, or stop.',
    onDrafts: false
  },
  'billing.add-document': {
    label: 'Add Document',
    description: 'Upload a facesheet, certification, signature form, ABN or MSP form.',
    onDrafts: true
  },
  'billing.chase-document': {
    label: 'Chase Document',
    description: 'Get a missing document by a due date.',
    onDrafts: false
  },
  'billing.respond-records-request': {
    label: 'Log Records Request',
    description: 'A payer asked for records; send them by the due date.',
    onDrafts: false
  },
  'billing.post-payment': {
    label: 'Post Payment',
    description: 'A payment or refund that came by mail, phone or card.',
    onDrafts: false
  }
} as const satisfies Record<string, ClaimTask>;

export type ClaimTaskKey = keyof typeof CLAIM_TASKS;

export const CLAIM_TASK_KEYS = Object.keys(CLAIM_TASKS) as [ClaimTaskKey, ...ClaimTaskKey[]];

export const MAX_CLAIM_PAYERS = 10;

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
