import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { titleCaseLabel } from '../format.ts';
import { RUN_STATUSES, RunStatusBadge, runStatusStyles } from './run-status-badge.tsx';

describe('RunStatusBadge', () => {
  it('names statuses for billers and colors them by intent', () => {
    const html = (status: 'faulted' | 'suspended' | 'cancelled') =>
      renderToStaticMarkup(createElement(RunStatusBadge, { status }));
    assert.ok(html('faulted').includes('>Stuck</span>'));
    assert.ok(html('faulted').includes('text-danger'));
    assert.ok(html('suspended').includes('>Waiting</span>'));
    assert.ok(html('suspended').includes('text-warning-fg'));
    assert.ok(html('cancelled').includes('text-surface-fg-muted'));
  });

  it('lists every status once with a Title Case label', () => {
    assert.deepEqual([...RUN_STATUSES].sort(), Object.keys(runStatusStyles).sort());
    for (const status of RUN_STATUSES) {
      const { label } = runStatusStyles[status];
      assert.equal(label, titleCaseLabel(label));
    }
  });
});
