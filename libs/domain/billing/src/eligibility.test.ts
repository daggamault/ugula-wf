import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eligibilityFinding } from './eligibility.ts';
import type { EligibilityResult } from './x271.ts';

const result: EligibilityResult = {
  trace: 'cov-1',
  active: true,
  planName: 'MEDICARE PART B',
  coverageStart: '2015-01-01',
  coverageEnd: null,
  advantagePlan: null,
  stay: null,
  messages: []
};

describe('eligibilityFinding', () => {
  it('records active and inactive coverage with the plan and dates', () => {
    assert.deepEqual(eligibilityFinding(result, 'MB'), {
      active: true,
      outcome: 'eligible',
      note: 'MEDICARE PART B; Covered 2015-01-01 to now'
    });
    assert.deepEqual(
      eligibilityFinding(
        { ...result, active: false, planName: null, coverageStart: null, messages: ['Ended'] },
        'CI'
      ),
      { active: false, outcome: 'ineligible', note: 'Ended' }
    );
  });

  it('notes an end date with no start and every payer message in order', () => {
    assert.deepEqual(
      eligibilityFinding(
        {
          ...result,
          active: false,
          planName: '',
          coverageStart: null,
          coverageEnd: '2026-06-30',
          messages: ['Terminated', 'Call payer']
        },
        'MB'
      ),
      {
        active: false,
        outcome: 'ineligible',
        note: 'Covered ? to 2026-06-30; Terminated; Call payer'
      }
    );
  });

  it('keeps the advantage note alone when the payer said nothing else', () => {
    assert.deepEqual(
      eligibilityFinding(
        { ...result, planName: null, coverageStart: null, advantagePlan: 'SUN MA' },
        'MA'
      ),
      { active: true, outcome: 'review', note: 'Bill the Medicare Advantage plan instead: SUN MA' }
    );
  });

  it('asks a biller when the payer did not say', () => {
    assert.deepEqual(
      eligibilityFinding({ ...result, active: null, planName: null, coverageStart: null }, 'MB'),
      { active: null, outcome: 'review', note: 'The payer did not say' }
    );
  });

  it('asks a biller to bill the Medicare Advantage plan a Medicare response names', () => {
    const advantage = { ...result, advantagePlan: 'SUNSHINE ADVANTAGE' };
    assert.deepEqual(eligibilityFinding(advantage, 'MB'), {
      active: true,
      outcome: 'review',
      note: 'Bill the Medicare Advantage plan instead: SUNSHINE ADVANTAGE; MEDICARE PART B; Covered 2015-01-01 to now'
    });
    assert.equal(eligibilityFinding(advantage, 'CI').outcome, 'eligible');
    assert.equal(eligibilityFinding(advantage, null).outcome, 'eligible');
  });
});
