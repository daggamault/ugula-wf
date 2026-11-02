export type QueueInfo = { label: string; description: string };

const QUEUES: Readonly<Record<string, QueueInfo>> = {
  'billing-review': {
    label: 'Billing review',
    description:
      'Confirm the level of service and mileage before a claim is priced, approve claims before they go to a payer, and check PCRs that changed after billing.'
  },
  'billing-patients': {
    label: 'Patient matching',
    description: 'Decide whether a PCR belongs to a patient you already have or a new one.'
  },
  'billing-payers': {
    label: 'Payer matching',
    description:
      'Match payer names from PCRs to your payer directory. Each answer is remembered for later PCRs.'
  },
  'billing-holds': {
    label: 'Held PCRs',
    description: 'PCRs a reviewer set aside. Release them back to review or void them.'
  },
  'billing-followup': {
    label: 'Payer follow-up',
    description: 'Claims a payer has not answered in 30 days.'
  },
  'billing-reconcile': {
    label: 'Reconcile payments',
    description: 'Payer responses that left a balance. Check them, then continue or write off.'
  },
  'billing-collections': {
    label: 'Balance review',
    description: 'Balances left after every payer and three patient statements.'
  },
  exceptions: {
    label: 'Stuck runs',
    description: 'Automation that hit an error and needs a decision before it can continue.'
  }
};

const ORDER = Object.keys(QUEUES);

export const humanize = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const queueInfo = (queue: string): QueueInfo =>
  (Object.hasOwn(QUEUES, queue) ? QUEUES[queue] : undefined) ?? {
    label: humanize(queue),
    description: ''
  };

const rank = (queue: string) => (ORDER.includes(queue) ? ORDER.indexOf(queue) : ORDER.length);

export const queueSortKey = (queue: string) => `${String(rank(queue)).padStart(3, '0')} ${queue}`;

export const byQueueOrder = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);
