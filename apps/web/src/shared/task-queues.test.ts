import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { humanize, queueInfo, titleCase } from './task-queues.ts';

describe('queues', () => {
  it('names known queues for billers and humanizes the rest', () => {
    assert.equal(queueInfo('billing-review').label, 'Billing Review');
    assert.match(queueInfo('billing-payers').description, /remembered/);
    assert.deepEqual(queueInfo('custom-intake'), { label: 'Custom Intake', description: '' });
    assert.equal(queueInfo('toString').label, 'To String');
  });

  it('turns keys and outcomes into sentence-case and Title Case labels', () => {
    assert.equal(humanize('keepWaiting'), 'Keep waiting');
    assert.equal(humanize('sendToCollections'), 'Send to collections');
    assert.equal(humanize('approve'), 'Approve');
    assert.equal(titleCase('sendToCollections'), 'Send to Collections');
    assert.equal(titleCase('keep_waiting'), 'Keep Waiting');
    assert.equal(queueInfo('custom-queue').label, 'Custom Queue');
  });
});
