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
  it('finds active coverage eligible, noting the plan and an open-ended coverage period', () => {
    assert.deepEqual(eligibilityFinding(result, 'MB'), {
      active: true,
      outcome: 'eligible',
      note: 'MEDICARE PART B; Covered 2015-01-01 to now'
    });
  });

  it('finds inactive coverage ineligible, noting the payer message', () => {
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

  it('notes a closed coverage period', () => {
    assert.deepEqual(
      eligibilityFinding({ ...result, planName: null, coverageEnd: '2026-12-31' }, 'CI'),
      { active: true, outcome: 'eligible', note: 'Covered 2015-01-01 to 2026-12-31' }
    );
  });

  it('leaves the note empty when an answer says nothing beyond whether it is active', () => {
    assert.deepEqual(eligibilityFinding({ ...result, planName: null, coverageStart: null }, 'CI'), {
      active: true,
      outcome: 'eligible',
      note: ''
    });
  });

  it('asks a biller when the payer did not say', () => {
    assert.deepEqual(
      eligibilityFinding({ ...result, active: null, planName: null, coverageStart: null }, 'MB'),
      { active: null, outcome: 'review', note: 'The payer did not say' }
    );
  });

  it('asks a biller when the payer did not say whether it is active, keeping what it did say', () => {
    assert.deepEqual(
      eligibilityFinding({ ...result, active: null, messages: ['Try later'] }, 'MB'),
      {
        active: null,
        outcome: 'review',
        note: 'MEDICARE PART B; Covered 2015-01-01 to now; Try later'
      }
    );
  });

  it('asks a biller to bill the Medicare Advantage plan a Medicare response names', () => {
    assert.deepEqual(eligibilityFinding({ ...result, advantagePlan: 'SUNSHINE ADVANTAGE' }, 'MB'), {
      active: true,
      outcome: 'review',
      note: 'Bill the Medicare Advantage plan instead: SUNSHINE ADVANTAGE; MEDICARE PART B; Covered 2015-01-01 to now'
    });
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

  it('ignores an advantage plan on a coverage that is not filed with Medicare', () => {
    const advantage = { ...result, advantagePlan: 'SUNSHINE ADVANTAGE' };
    const eligible = {
      active: true,
      outcome: 'eligible',
      note: 'MEDICARE PART B; Covered 2015-01-01 to now'
    };
    assert.deepEqual(eligibilityFinding(advantage, 'CI'), eligible);
    assert.deepEqual(eligibilityFinding(advantage, null), eligible);
  });
});
