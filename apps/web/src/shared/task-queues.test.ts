import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assigneeOf, humanize, queueInfo, titleCase } from './task-queues.ts';

describe('humanize', () => {
  it('splits camelCase keys into a sentence-case phrase', () => {
    assert.equal(humanize('keepWaiting'), 'Keep waiting');
    assert.equal(humanize('sendToCollections'), 'Send to collections');
  });

  it('turns runs of underscores and dashes into single spaces', () => {
    assert.equal(humanize('keep__waiting'), 'Keep waiting');
    assert.equal(humanize('billing-review'), 'Billing review');
  });

  it('splits a digit followed by a capital and trims stray separators', () => {
    assert.equal(humanize('step2Retry'), 'Step2 retry');
    assert.equal(humanize('_approve_'), 'Approve');
  });

  it('capitalizes a single word and leaves an empty key empty', () => {
    assert.equal(humanize('approve'), 'Approve');
    assert.equal(humanize(''), '');
  });
});

describe('titleCase', () => {
  it('title-cases a key, keeping minor words lower inside it', () => {
    assert.equal(titleCase('sendToCollections'), 'Send to Collections');
    assert.equal(titleCase('keep_waiting'), 'Keep Waiting');
  });

  it('keeps the known acronyms', () => {
    assert.equal(titleCase('reviewPcr'), 'Review PCR');
  });
});

describe('queueInfo', () => {
  it('names a known queue and describes it for billers', () => {
    assert.deepEqual(queueInfo('billing-payers'), {
      label: 'Payer Matching',
      description:
        'Match payer names from PCRs to your payer directory. Each answer is remembered for later PCRs.'
    });
    assert.equal(queueInfo('exceptions').label, 'Stuck Runs');
  });

  it('title-cases an unknown queue without a description', () => {
    assert.deepEqual(queueInfo('custom-intake'), { label: 'Custom Intake', description: '' });
  });

  it('does not treat inherited object keys as known queues', () => {
    assert.deepEqual(queueInfo('toString'), { label: 'To String', description: '' });
    assert.deepEqual(queueInfo('constructor'), { label: 'Constructor', description: '' });
  });
});

describe('assigneeOf', () => {
  it('names the signed in user as You', () => {
    assert.equal(assigneeOf('me@example.com', 'me@example.com'), 'You');
  });

  it('names another assignee by email', () => {
    assert.equal(assigneeOf('sam@example.com', 'me@example.com'), 'sam@example.com');
  });

  it('names a task without an assignee as Unassigned', () => {
    assert.equal(assigneeOf(null, 'me@example.com'), 'Unassigned');
  });
});
