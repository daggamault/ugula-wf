import type { EventDef, PinSpec } from '@ugula/graph';

export const BILLING_EVENTS = {
  claimCreated: 'claim.created',
  claimEdited: 'claim.edited',
  taskCompleted: 'task.completed'
} as const;

const p = (name: string, type: PinSpec['type'], label: string, description: string): PinSpec => ({
  name,
  type,
  label,
  description
});

export const billingEvents: EventDef[] = [
  {
    type: BILLING_EVENTS.claimCreated,
    label: 'Claim Created',
    description: 'A claim was saved for an encounter and needs review.',
    payload: [
      p('claimId', { id: 'claim' }, 'Claim', 'The claim saved.'),
      p('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter the claim bills.')
    ]
  },
  {
    type: BILLING_EVENTS.claimEdited,
    label: 'Claim Edited',
    description: 'A biller corrected a claim, which made a new revision that needs review.',
    payload: [
      p('claimId', { id: 'claim' }, 'Claim', 'The claim corrected.'),
      p('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter the claim bills.'),
      p('revision', 'integer', 'Revision', 'The revision the correction made.')
    ]
  },
  {
    type: BILLING_EVENTS.taskCompleted,
    label: 'Task Completed',
    description: 'A biller completed a task.',
    payload: [
      p('taskId', { id: 'task' }, 'Task', 'The task completed.'),
      { ...p('queue', 'string', 'Queue', 'The work queue the task was in.'), optional: true },
      { ...p('outcome', 'string', 'Outcome', 'The option the biller chose.'), optional: true }
    ]
  }
];
