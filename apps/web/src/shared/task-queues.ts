import { titleCaseWords } from './format.ts';

type QueueInfo = { label: string; description: string };

const QUEUES: Readonly<Record<string, QueueInfo>> = {
  'billing-review': {
    label: 'Billing Review',
    description:
      'Confirm the trip and service before a claim is priced, set missing charges, fix claim data, approve and submit claims, and check PCRs that changed after billing.'
  },
  'billing-patients': {
    label: 'Patient Matching',
    description:
      'Confirm whether a PCR belongs to a likely patient or a new one, and fill in a missing name or birth date.'
  },
  'billing-payers': {
    label: 'Payer Matching',
    description:
      'Match payer names from PCRs to your payer directory. Each answer is remembered for later PCRs.'
  },
  'billing-holds': {
    label: 'Held PCRs',
    description: 'PCRs a reviewer set aside. Release them back to review or void them.'
  },
  'billing-followup': {
    label: 'Payer Follow-Up',
    description:
      'Claims a payer has not answered in 30 days, overdue appeal decisions and deadlines about to lapse.'
  },
  'billing-reconcile': {
    label: 'Reconcile Payments',
    description:
      'Payer responses that left a balance, and denials to correct or appeal. Check them, then continue, correct, appeal or write off.'
  },
  'billing-collections': {
    label: 'Balance Review',
    description: 'Balances left after every payer and three patient statements.'
  },
  'billing-documents': {
    label: 'Document Chase',
    description:
      'Missing facesheets, certifications, signature forms, ABNs and MSP forms to get and upload, each due by its date.'
  },
  'billing-approvals': {
    label: 'Approvals',
    description:
      'Refunds, write-offs above the Claim Policy limit and collections placements waiting for someone who may approve them.'
  },
  exceptions: {
    label: 'Stuck Runs',
    description: 'Automation that hit an error and needs a decision before it can continue.'
  }
};

export const humanize = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const titleCase = (key: string) => titleCaseWords(humanize(key).split(' '));

export const queueInfo = (queue: string): QueueInfo =>
  (Object.hasOwn(QUEUES, queue) ? QUEUES[queue] : undefined) ?? {
    label: titleCase(queue),
    description: ''
  };
