import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_TASK_KEYS, CLAIM_TASKS, readPayerNames } from './claim-tasks.ts';

describe('CLAIM_TASKS', () => {
  it('names each claim task workflow a biller can start, and which work on drafts', () => {
    assert.equal(CLAIM_TASK_KEYS.length, 7);
    assert.equal(CLAIM_TASKS['billing.post-payment'].label, 'Post Payment');
    assert.deepEqual(
      CLAIM_TASK_KEYS.filter((k) => CLAIM_TASKS[k].onDrafts),
      ['billing.add-document']
    );
  });
});

describe('readPayerNames', () => {
  it('trims names and drops blank lines, keeping the order', () => {
    assert.deepEqual(readPayerNames([' Medicare ', '', 'Blue Plan', 3]), ['Medicare', 'Blue Plan']);
    assert.deepEqual(readPayerNames(null), []);
  });

  it('refuses a payer listed twice, a name too long or too many payers', () => {
    assert.equal(readPayerNames(['Medicare', 'medicare']), 'medicare is listed twice');
    assert.match(String(readPayerNames(['x'.repeat(61)])), /at most 60 characters/);
    assert.match(
      String(readPayerNames(Array.from({ length: 11 }, (_, i) => `P${i}`))),
      /at most 10 payers/
    );
  });
});
