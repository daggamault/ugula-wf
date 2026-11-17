import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OUTCOME_STYLES } from './payer-file-outcomes.ts';

describe('OUTCOME_STYLES', () => {
  it('labels each outcome in Title Case with an intent matching its result', () => {
    assert.deepEqual(OUTCOME_STYLES, {
      posted: { intent: 'success', label: 'Posted' },
      accepted: { intent: 'success', label: 'Accepted' },
      eligible: { intent: 'success', label: 'Eligible' },
      duplicate: { label: 'Already Posted' },
      rejected: { intent: 'danger', label: 'Rejected' },
      ineligible: { intent: 'danger', label: 'Not Eligible' },
      unmatched: { intent: 'warning', label: 'No Match' },
      review: { intent: 'warning', label: 'Needs Review' },
      status: { intent: 'info', label: 'Status' }
    });
  });
});
