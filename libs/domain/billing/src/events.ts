import type { EventDef, PinSpec } from '@ugula/graph';

export const BILLING_EVENTS = {
  claimCreated: 'claim.created',
  claimApproved: 'claim.approved',
  claimEdited: 'claim.edited',
  claimRejected: 'claim.rejected',
  claimAdjudicated: 'claim.adjudicated',
  clearinghouseFileReceived: 'clearinghouse_file.received',
  remittanceReceived: 'remittance.received',
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
    type: BILLING_EVENTS.claimApproved,
    label: 'Claim Approved',
    description: 'A biller approved a claim, so it is ready for the clearinghouse.',
    payload: [
      p('claimId', { id: 'claim' }, 'Claim', 'The claim approved.'),
      p('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter the claim bills.'),
      p('revision', 'integer', 'Revision', 'The revision approved.')
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
    type: BILLING_EVENTS.claimRejected,
    label: 'Claim Rejected',
    description: 'The clearinghouse or a payer rejected a claim before deciding it.',
    payload: [
      p('claimId', { id: 'claim' }, 'Claim', 'The claim rejected.'),
      p('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter the claim bills.'),
      p(
        'position',
        'integer',
        'Payer',
        'Which payer of the claim it was sent to, 1 for the first.'
      ),
      p('reason', 'string', 'Reason', 'Why it was rejected, as the acknowledgment says.')
    ]
  },
  {
    type: BILLING_EVENTS.claimAdjudicated,
    label: 'Payment Posted',
    description:
      'A remittance posted what a payer paid, denied, forwarded or took back on a claim.',
    payload: [
      p('claimId', { id: 'claim' }, 'Claim', 'The claim the payment is for.'),
      p('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter the claim bills.'),
      p('paymentId', { id: 'payment' }, 'Payment', 'The payment posted.'),
      p('outcome', { code: 'paymentOutcome' }, 'Outcome', 'What the payer did with the claim.')
    ]
  },
  {
    type: BILLING_EVENTS.clearinghouseFileReceived,
    label: 'Clearinghouse File Received',
    description:
      'A file arrived from the clearinghouse: an acknowledgment, a remittance or another answer.',
    payload: [
      p('fileId', { id: 'clearinghouseFile' }, 'File', 'The file received.'),
      p('kind', { code: 'fileKind' }, 'Kind', 'What the file is, read from its content.'),
      p('fileName', 'string', 'File Name', 'The name of the file on the clearinghouse server.')
    ]
  },
  {
    type: BILLING_EVENTS.remittanceReceived,
    label: 'Remittance Received',
    description: 'A remittance (835) was posted, ready to reconcile.',
    payload: [p('remittanceId', { id: 'remittance' }, 'Remittance', 'The remittance posted.')]
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
