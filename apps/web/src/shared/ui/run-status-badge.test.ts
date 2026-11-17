import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { titleCaseLabel } from '../format.ts';
import { render, screen } from '../testing-dom.ts';
import {
  RUN_STATUSES,
  type RunStatus,
  RunStatusBadge,
  runStatusStyles
} from './run-status-badge.tsx';

const badgeOf = (status: RunStatus) => {
  render(createElement(RunStatusBadge, { status }));
  return screen.getByText(runStatusStyles[status].label);
};

describe('RunStatusBadge', () => {
  it('names each status in words billers use', () => {
    assert.deepEqual(
      RUN_STATUSES.map((status) => {
        const { container, unmount } = render(createElement(RunStatusBadge, { status }));
        const text = container.textContent;
        unmount();
        return text;
      }),
      ['Running', 'Waiting', 'Stuck', 'Completed', 'Failed', 'Cancelled']
    );
  });

  it('colors a status by its intent', () => {
    assert.equal(badgeOf('faulted').classList.contains('text-danger'), true);
    assert.equal(badgeOf('suspended').classList.contains('text-warning-text'), true);
    assert.equal(badgeOf('running').classList.contains('text-info'), true);
    assert.equal(badgeOf('completed').classList.contains('text-success'), true);
  });

  it('shows a cancelled run in neutral colors', () => {
    assert.equal(badgeOf('cancelled').classList.contains('text-surface-fg-muted'), true);
  });
});

describe('RUN_STATUSES', () => {
  it('lists every styled status exactly once', () => {
    assert.equal(new Set(RUN_STATUSES).size, RUN_STATUSES.length);
    assert.deepEqual([...RUN_STATUSES].sort(), Object.keys(runStatusStyles).sort());
  });

  it('labels every status in Title Case', () => {
    for (const status of RUN_STATUSES) {
      const { label } = runStatusStyles[status];
      assert.equal(label, titleCaseLabel(label));
    }
  });
});
