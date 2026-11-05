import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newWork, workToast } from './work-alerts.ts';

const q = (queue: string, open: number) => ({ queue, open, unassigned: open, mine: 0, oldest: '' });

describe('newWork', () => {
  it('reports queues that grew since the last look, never on the first one', () => {
    assert.deepEqual(newWork(undefined, [q('billing-review', 3)]), []);
    assert.deepEqual(
      newWork(
        [q('billing-review', 3), q('exceptions', 1)],
        [q('billing-review', 5), q('exceptions', 0), q('billing-payers', 1)]
      ),
      [
        { queue: 'billing-review', added: 2 },
        { queue: 'billing-payers', added: 1 }
      ]
    );
  });
});

describe('workToast', () => {
  it('says what arrived where, replaces older news for the queue and links to it', () => {
    assert.deepEqual(workToast({ queue: 'billing-review', added: 2 }), {
      key: 'new-work:billing-review',
      isRecorded: false,
      intent: 'info',
      title: '2 new tasks in Billing Review',
      action: { label: 'Open Billing Review', to: '/tasks?queue=billing-review' }
    });
    assert.equal(workToast({ queue: 'exceptions', added: 1 }).title, '1 new task in Stuck Runs');
  });
});
