import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { render } from '../../shared/testing-dom.ts';
import { CopyBadge, ScopeBadge, StaleBadge, scopeLabel } from './scope-badges.tsx';

const badge = (el: ReactElement) => {
  const { container } = render(el);
  const span = container.querySelector('span');
  return span && { text: span.textContent, accent: span.className.includes('text-custom') };
};

describe('scopeLabel', () => {
  it('names each scope', () => {
    assert.equal(scopeLabel('system'), 'Standard');
    assert.equal(scopeLabel('agency'), 'Custom');
  });
});

describe('ScopeBadge', () => {
  it('shows standard workflows plainly', () => {
    assert.deepEqual(badge(createElement(ScopeBadge, { scope: 'system' })), {
      text: 'Standard',
      accent: false
    });
  });

  it('marks agency workflows with the custom accent', () => {
    assert.deepEqual(badge(createElement(ScopeBadge, { scope: 'agency' })), {
      text: 'Custom',
      accent: true
    });
  });
});

describe('CopyBadge', () => {
  it('says when an agency copy is in effect instead', () => {
    assert.deepEqual(badge(createElement(CopyBadge, { scope: 'system', effective: 'agency' })), {
      text: 'Has Custom Copy',
      accent: true
    });
  });

  it('shows nothing when the workflow itself is in effect', () => {
    assert.equal(badge(createElement(CopyBadge, { scope: 'agency', effective: 'agency' })), null);
    assert.equal(badge(createElement(CopyBadge, { scope: 'system', effective: 'system' })), null);
  });
});

describe('StaleBadge', () => {
  it('warns only when the base has changed since the copy', () => {
    assert.deepEqual(badge(createElement(StaleBadge, { stale: true })), {
      text: 'Base Updated',
      accent: false
    });
    assert.equal(badge(createElement(StaleBadge, { stale: false })), null);
  });
});
