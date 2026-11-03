import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { titleCaseLabel } from './format.ts';
import { OUTCOME_STYLES } from './payer-file-outcomes.ts';

describe('OUTCOME_STYLES', () => {
  it('labels every outcome in Title Case with an intent matching its result', () => {
    for (const { label } of Object.values(OUTCOME_STYLES)) {
      assert.equal(label, titleCaseLabel(label));
    }
    assert.equal(OUTCOME_STYLES.posted.intent, 'success');
    assert.equal(OUTCOME_STYLES.rejected.intent, 'danger');
    assert.equal(OUTCOME_STYLES.review.intent, 'warning');
    assert.equal(OUTCOME_STYLES.duplicate.intent, undefined);
  });
});
