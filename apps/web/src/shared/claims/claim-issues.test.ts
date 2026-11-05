import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClaimIssues, isIssueList } from './claim-issues.tsx';

const ISSUES = [
  {
    code: 'member-id-missing',
    severity: 'blocking',
    field: 'memberId',
    message: 'The member ID is missing',
    coverageId: 'c1'
  },
  {
    code: 'loaded-miles-unlikely',
    severity: 'warning',
    field: 'loadedMiles',
    message: 'Check the odometers',
    coverageId: null
  }
] as const;

describe('ClaimIssues', () => {
  it('recognizes claim issues', () => {
    assert.equal(isIssueList([...ISSUES]), true);
    assert.equal(isIssueList([{ severity: 'oops', field: 'memberId', message: 'x' }]), false);
    assert.equal(isIssueList('x'), false);
  });

  it('splits blocking issues from warnings, each labelled by field', () => {
    const html = renderToStaticMarkup(createElement(ClaimIssues, { issues: ISSUES }));
    assert.ok(html.includes('Must Be Fixed') && html.includes('Worth Checking'));
    assert.ok(html.includes('bg-danger/10') && html.includes('bg-warning/10'));
    assert.ok(html.includes('Member ID: </span>The member ID is missing'));
    assert.ok(html.includes('Loaded Miles: </span>Check the odometers'));
    assert.equal(renderToStaticMarkup(createElement(ClaimIssues, { issues: [] })), '');
  });
});
