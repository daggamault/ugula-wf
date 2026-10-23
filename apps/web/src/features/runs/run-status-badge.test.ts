import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunStatusBadge } from './run-status-badge.tsx';

describe('RunStatusBadge', () => {
  it('names statuses for billers and colors them by intent', () => {
    const html = (status: 'faulted' | 'suspended') =>
      renderToStaticMarkup(createElement(RunStatusBadge, { status }));
    assert.ok(html('faulted').includes('Stuck'));
    assert.ok(html('faulted').includes('text-danger'));
    assert.ok(html('suspended').includes('Waiting'));
  });
});
