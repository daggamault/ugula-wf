import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimIssue } from '@ugula/billing';
import { createElement } from 'react';
import { render, screen, within } from '../testing-dom.ts';
import { ClaimIssues, isIssueList } from './claim-issues.tsx';

const blocking: ClaimIssue = {
  code: 'member-id-missing',
  severity: 'blocking',
  field: 'memberId',
  message: 'The member ID is missing',
  coverageId: 'c1'
};

const warning: ClaimIssue = {
  code: 'loaded-miles-unlikely',
  severity: 'warning',
  field: 'loadedMiles',
  message: 'Check the odometers',
  coverageId: null
};

const items = (el: HTMLElement) =>
  within(el)
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('isIssueList', () => {
  it('accepts a list of claim issues, including an empty one', () => {
    assert.equal(isIssueList([blocking, warning]), true);
    assert.equal(isIssueList([]), true);
  });

  it('rejects an issue with an unknown severity or field, or without a message', () => {
    assert.equal(isIssueList([{ ...blocking, severity: 'oops' }]), false);
    assert.equal(isIssueList([{ ...blocking, field: 'nope' }]), false);
    assert.equal(isIssueList([{ ...blocking, message: 3 }]), false);
    assert.equal(isIssueList(['x']), false);
  });

  it('rejects anything but a list', () => {
    assert.equal(isIssueList('x'), false);
    assert.equal(isIssueList({ ...blocking }), false);
    assert.equal(isIssueList(undefined), false);
  });
});

describe('ClaimIssues', () => {
  it('raises blocking issues as an alert, each labelled by its field', () => {
    render(
      createElement(ClaimIssues, {
        issues: [blocking, { ...blocking, field: 'payer', message: 'Pick a payer' }]
      })
    );
    const alert = screen.getByRole('alert');
    assert.ok(within(alert).getByText('Must Be Fixed'));
    assert.deepEqual(items(alert), ['Member ID: The member ID is missing', 'Payer: Pick a payer']);
    assert.ok(!screen.queryByRole('status'));
  });

  it('lists warnings apart from blocking issues', () => {
    render(createElement(ClaimIssues, { issues: [warning, blocking] }));
    const status = screen.getByRole('status');
    assert.ok(within(status).getByText('Worth Checking'));
    assert.deepEqual(items(status), ['Loaded Miles: Check the odometers']);
    assert.deepEqual(items(screen.getByRole('alert')), ['Member ID: The member ID is missing']);
  });

  it('shows nothing without issues', () => {
    const { container } = render(createElement(ClaimIssues, { issues: [] }));
    assert.equal(container.innerHTML, '');
  });
});
