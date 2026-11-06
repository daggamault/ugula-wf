import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { claimDetail } from '../../shared/claims/testing.ts';
import { TaskClaimView } from './task-claim.tsx';

const codes = {
  hcpcs: { A0427: 'ALS1 emergency' },
  icd10cm: { R079: 'Chest pain, unspecified' }
};

describe('TaskClaimView', () => {
  it('shows the whole claim read only, with every code described', () => {
    const html = renderToStaticMarkup(
      createElement(TaskClaimView, { record: { claim: claimDetail, codes, issues: [] } })
    );
    for (const panel of ['Summary', 'Charges', 'Claim Data', 'Documentation', 'Payers']) {
      assert.ok(html.includes(`>${panel}</h2>`), panel);
    }
    assert.ok(html.includes('A0427') && html.includes('ALS1 emergency'));
    assert.ok(html.includes('R07.9') && html.includes('Chest pain, unspecified'));
    assert.ok(!html.includes('<button'));
  });

  it('flags claim values that differ from the encounter', () => {
    const html = renderToStaticMarkup(
      createElement(TaskClaimView, {
        record: { claim: { ...claimDetail, lines: [] }, codes: {}, issues: [] },
        mismatches: [{ field: 'loadedMiles', label: 'Loaded Miles', encounter: '12.4' }],
        encounterHref: '/tasks/t1?tab=encounter'
      })
    );
    assert.ok(html.includes('1 value differs') && html.includes('Loaded Miles.'));
    assert.ok(html.includes('href="/tasks/t1?tab=encounter"'));
    assert.ok(html.includes('No charge lines yet.'));
  });
});
