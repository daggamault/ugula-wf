import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_TASK_KEYS, CLAIM_TASKS, claimTaskStartsOn, readPayerNames } from './claim-tasks.ts';

describe('CLAIM_TASKS', () => {
  it('names each claim task workflow a biller can start, and which work on drafts', () => {
    assert.deepEqual(CLAIM_TASK_KEYS, [
      'billing.correct-claim-data',
      'billing.change-responsible-party',
      'billing.receive-document',
      'billing.chase-document',
      'billing.log-records-request',
      'billing.post-payment'
    ]);
    assert.deepEqual(
      CLAIM_TASK_KEYS.filter((k) => CLAIM_TASKS[k].onDrafts),
      ['billing.receive-document']
    );
  });

  it('starts a task on an open claim, on a draft when it works on drafts, and a payment on a closed claim but a void one', () => {
    const on = (status: string) => CLAIM_TASK_KEYS.filter((k) => claimTaskStartsOn(k, status));
    assert.deepEqual(on('submitted'), CLAIM_TASK_KEYS);
    assert.deepEqual(on('draft'), ['billing.receive-document']);
    assert.deepEqual(on('paid'), ['billing.post-payment']);
    assert.deepEqual(on('collections'), ['billing.post-payment']);
    assert.deepEqual(on('void'), []);
  });
});

describe('readPayerNames', () => {
  it('trims names and drops blank lines, keeping the order', () => {
    assert.deepEqual(readPayerNames([' Medicare ', '', 'Blue Plan', 3]), ['Medicare', 'Blue Plan']);
    assert.deepEqual(readPayerNames(null), []);
  });

  it('refuses a payer listed twice, a name too long or too many payers', () => {
    assert.equal(readPayerNames(['Medicare', 'medicare']), 'medicare is listed twice');
    assert.equal(
      readPayerNames(['Medicare', 'x'.repeat(61)]),
      `Payer names have at most 60 characters: ${'x'.repeat(61)}`
    );
    assert.equal(
      readPayerNames(Array.from({ length: 11 }, (_, i) => `P${i}`)),
      'A claim can have at most 10 payers'
    );
  });

  it('accepts up to ten payers of up to sixty characters, not counting blank lines', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `P${i}`);
    assert.deepEqual(readPayerNames([...ten, ' ', '']), ten);
    assert.deepEqual(readPayerNames([` ${'x'.repeat(60)} `]), ['x'.repeat(60)]);
  });
});
