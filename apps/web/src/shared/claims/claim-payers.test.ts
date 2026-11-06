import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClaimCoverage } from './claim-detail.ts';
import { coverageIds, insuredText, PayersPanel } from './claim-payers.tsx';

const coverage = (over: Partial<ClaimCoverage> = {}): ClaimCoverage => ({
  id: 'c',
  position: 1,
  payer: 'Medicare',
  payer_id: 'p1',
  payer_code: null,
  member_id: '1EG4',
  group_id: null,
  relationship: '18',
  insured_first_name: null,
  insured_last_name: null,
  eligibility: null,
  eligibility_note: null,
  eligibility_checked_at: null,
  stay_kind: null,
  stay_admitted_on: null,
  stay_discharged_on: null,
  ...over
});

describe('PayersPanel', () => {
  it('lists the payers in billing order with member IDs and the insured', () => {
    const html = renderToStaticMarkup(
      createElement(PayersPanel, {
        coverages: [
          coverage(),
          coverage({
            id: 'b',
            payer: 'Blue Plan',
            payer_id: null,
            member_id: null,
            relationship: '01',
            insured_first_name: 'John',
            insured_last_name: 'Doe'
          })
        ]
      })
    );
    assert.ok(html.includes('1. </span>Medicare') && html.includes('2. </span>Blue Plan'));
    assert.equal(html.match(/Not in Payer Directory/g)?.length, 1);
    assert.ok(!html.includes('<button') && !html.includes('<input'));
  });

  it('says when the patient is billed directly', () => {
    const html = renderToStaticMarkup(createElement(PayersPanel, { coverages: [] }));
    assert.ok(html.includes('The patient will be billed directly'));
  });

  it('describes member and group IDs and who the insured is', () => {
    assert.equal(coverageIds(coverage({ group_id: 'G7' })), 'Member ID 1EG4 · group G7');
    assert.equal(coverageIds(coverage({ member_id: null })), 'No member ID');
    assert.equal(insuredText(coverage()), 'Patient is the insured');
    assert.match(
      insuredText(
        coverage({ relationship: '01', insured_first_name: 'John', insured_last_name: 'Doe' })
      ),
      /^Insured: John Doe \(patient is the /
    );
  });
});
