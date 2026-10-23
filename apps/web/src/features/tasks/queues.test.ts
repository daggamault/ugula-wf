import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { byQueueOrder, humanize, queueInfo } from './queues.ts';

describe('queues', () => {
  it('names known queues for billers and humanizes the rest', () => {
    assert.equal(queueInfo('billing-review').label, 'PCR review');
    assert.match(queueInfo('billing-payers').description, /remembered/);
    assert.deepEqual(queueInfo('custom-intake'), { label: 'Custom intake', description: '' });
    assert.equal(queueInfo('toString').label, 'To string');
  });

  it('turns keys and outcomes into sentence-case labels', () => {
    assert.equal(humanize('keepWaiting'), 'Keep waiting');
    assert.equal(humanize('sendToCollections'), 'Send to collections');
    assert.equal(humanize('approve'), 'Approve');
  });

  it('orders queues by the billing flow, then alphabetically', () => {
    assert.deepEqual(
      ['zeta', 'exceptions', 'billing-collections', 'alpha', 'billing-review'].sort(byQueueOrder),
      ['billing-review', 'billing-collections', 'exceptions', 'alpha', 'zeta']
    );
  });
});
